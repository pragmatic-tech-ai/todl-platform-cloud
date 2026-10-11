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

    test(`${backend}: records chain and Verify holds across a reopen`, async () =>
    {
        const session = await makeSession()
        const t = `audit-${randomUUID()}`
        const first = await SqlAuditStore.Open(session)
        await first.Record(event(t, new Map([['a', '1']])))
        await first.Record(event(t, new Map([['b', '2']])))
        assert.equal(first.Verify(t), true)
        assert.equal(first.Records(t).length, 2)
        const reopened = await SqlAuditStore.Open(session)
        assert.equal(reopened.Verify(t), true)
        assert.equal(reopened.Records(t).length, 2)
    })

    test(`${backend}: distinct tenants keep independent chains`, async () =>
    {
        const session = await makeSession()
        const store = await SqlAuditStore.Open(session)
        const a = `audit-${randomUUID()}`
        const b = `audit-${randomUUID()}`
        await store.Record(event(a, new Map()))
        await store.Record(event(b, new Map()))
        assert.equal(store.Records(a).length, 1)
        assert.equal(store.Records(b).length, 1)
    })
})
