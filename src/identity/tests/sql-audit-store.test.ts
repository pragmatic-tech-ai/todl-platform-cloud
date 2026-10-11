import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlAuditStore } from '../sql-audit-store.js'

SqlTestSessions.Describe('SqlAuditStore', (makeSession, backend) =>
{
    const event = (tenant: string, detail: ReadonlyMap<string, string>) =>
        new AuditEvent(AuditEventKind.Authentication, tenant, 'p1', new Date('2020-01-01T00:00:00Z'), detail)

    test(`${backend}: records chain and replay is deterministic across a reopen`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const first = await SqlAuditStore.Open(session)
        await first.Record(event(t, new Map([['a', '1']])))
        await first.Record(event(t, new Map([['b', '2']])))
        assert.equal(first.Verify(t), true)
        assert.equal(first.Records(t).length, 2)
        const beforeHashes = first.Records(t).map(r => r.Hash)
        const beforePrev = first.Records(t).map(r => r.PrevHash)
        const reopened = await SqlAuditStore.Open(session)
        assert.equal(reopened.Verify(t), true)
        assert.equal(reopened.Records(t).length, 2)
        assert.deepEqual(reopened.Records(t).map(r => r.Hash), beforeHashes)
        assert.deepEqual(reopened.Records(t).map(r => r.PrevHash), beforePrev)
    })

    test(`${backend}: null PrincipalId and multi-key Detail round-trip`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const first = await SqlAuditStore.Open(session)
        await first.Record(new AuditEvent(AuditEventKind.Authentication, t, null, new Date('2020-01-01T00:00:00Z'), new Map([['a', '1'], ['b', '2']])))
        const reopened = await SqlAuditStore.Open(session)
        const recs = reopened.Records(t)
        assert.equal(recs.length, 1)
        assert.equal(recs[0]!.Event.PrincipalId, null)
        assert.deepEqual([...recs[0]!.Event.Detail], [['a', '1'], ['b', '2']])
        assert.equal(reopened.Verify(t), true)
    })

    test(`${backend}: distinct tenants keep independent chains`, async () =>
    {
        const session = await makeSession()
        const store = await SqlAuditStore.Open(session)
        const ta = `audit-${randomUUID()}`
        const tb = `audit-${randomUUID()}`
        await store.Record(event(ta, new Map()))
        await store.Record(event(tb, new Map()))
        await store.Record(event(ta, new Map([['x', '1']])))
        assert.equal(store.Records(ta).length, 2)
        assert.equal(store.Records(tb).length, 1)
        const rowsA = await session.Query('SELECT seq FROM identity_audit WHERE tenant_id = $1 ORDER BY seq', [ta])
        const rowsB = await session.Query('SELECT seq FROM identity_audit WHERE tenant_id = $1 ORDER BY seq', [tb])
        assert.deepEqual(rowsA.map(r => Number(r.seq)), [0, 1])
        assert.deepEqual(rowsB.map(r => Number(r.seq)), [0])
        const reopened = await SqlAuditStore.Open(session)
        assert.equal(reopened.Verify(ta), true)
        assert.equal(reopened.Verify(tb), true)
    })
})
