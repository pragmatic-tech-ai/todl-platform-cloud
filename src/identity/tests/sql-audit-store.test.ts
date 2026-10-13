import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { AuditTamperDetected } from '@pragmatic-tech-ai/todl-identity-host'
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

    test(`${backend}: hash and prev_hash are persisted and equal the chain`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        await store.Record(event(t, new Map([['a', '1']])))
        await store.Record(event(t, new Map([['b', '2']])))
        const rows = await session.Query('SELECT hash, prev_hash FROM identity_audit WHERE tenant_id = $1 ORDER BY seq', [t])
        assert.equal(rows.length, 2)
        assert.deepEqual(rows.map(r => String(r.hash)), store.Records(t).map(r => r.Hash))
        assert.deepEqual(rows.map(r => String(r.prev_hash)), store.Records(t).map(r => r.PrevHash))
    })

    test(`${backend}: tampered detail makes Open throw AuditTamperDetected`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        await store.Record(event(t, new Map([['a', '1']])))
        await store.Record(event(t, new Map([['b', '2']])))
        await session.Execute('UPDATE identity_audit SET detail = $1 WHERE tenant_id = $2 AND seq = 0', [JSON.stringify([['a', 'evil']]), t])
        await assert.rejects(() => SqlAuditStore.Open(session), AuditTamperDetected)
        await session.Execute('DELETE FROM identity_audit WHERE tenant_id = $1', [t])
    })

    test(`${backend}: tampered seq makes Open throw`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        await store.Record(event(t, new Map()))
        await store.Record(event(t, new Map([['b', '2']])))
        await session.Execute('UPDATE identity_audit SET seq = 5 WHERE tenant_id = $1 AND seq = 1', [t])
        await assert.rejects(() => SqlAuditStore.Open(session), AuditTamperDetected)
        await session.Execute('DELETE FROM identity_audit WHERE tenant_id = $1', [t])
    })

    test(`${backend}: mid-chain delete (seq gap) makes Open throw`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        await store.Record(event(t, new Map([['a', '1']])))
        await store.Record(event(t, new Map([['b', '2']])))
        await store.Record(event(t, new Map([['c', '3']])))
        await session.Execute('DELETE FROM identity_audit WHERE tenant_id = $1 AND seq = 1', [t])
        await assert.rejects(() => SqlAuditStore.Open(session), AuditTamperDetected)
        await session.Execute('DELETE FROM identity_audit WHERE tenant_id = $1', [t])
    })

    test(`${backend}: legacy NULL-hash rows are backfilled on Open`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        await SqlAuditStore.Open(session)
        for (let i = 0; i < 2; i++)
        {
            await session.Execute('INSERT INTO identity_audit (tenant_id, seq, kind, principal_id, at, detail, hash, prev_hash) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)', [t, i, AuditEventKind.Authentication, 'p1', '2020-01-01T00:00:00.000Z', JSON.stringify([['n', String(i)]])])
        }
        const first = await SqlAuditStore.Open(session)
        assert.equal(first.Verify(t), true)
        const rows = await session.Query('SELECT hash, prev_hash FROM identity_audit WHERE tenant_id = $1 ORDER BY seq', [t])
        assert.ok(rows.every(r => r.hash !== null && r.prev_hash !== null))
        const second = await SqlAuditStore.Open(session)
        assert.equal(second.Verify(t), true)
        assert.deepEqual(second.Records(t).map(r => r.Hash), first.Records(t).map(r => r.Hash))
    })

    test(`${backend}: concurrent Record for one tenant stays contiguous and verifiable`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        const n = 12
        await Promise.all(Array.from({ length: n }, (_, i) => store.Record(event(t, new Map([['i', String(i)]])))))
        const rows = await session.Query('SELECT seq FROM identity_audit WHERE tenant_id = $1 ORDER BY seq', [t])
        assert.deepEqual(rows.map(r => Number(r.seq)), Array.from({ length: n }, (_, i) => i))
        assert.equal(store.Records(t).length, n)
        assert.equal(store.Verify(t), true)
        const reopened = await SqlAuditStore.Open(session)
        assert.equal(reopened.Verify(t), true)
    })

    test(`${backend}: a losing insert rejects and does not enter the in-memory chain`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        await store.Record(event(t, new Map([['a', '1']])))
        const other = await SqlAuditStore.Open(session)
        await other.Record(event(t, new Map([['winner', 'x']])))
        await assert.rejects(() => store.Record(event(t, new Map([['loser', 'y']]))))
        assert.equal(store.Records(t).length, 1)
        assert.equal(store.Verify(t), true)
        const reopened = await SqlAuditStore.Open(session)
        assert.equal(reopened.Records(t).length, 2)
        assert.equal(reopened.Verify(t), true)
    })
})
