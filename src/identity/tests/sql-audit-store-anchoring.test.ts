import type { ISqlSession } from '@pragmatic-tech-ai/todl'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { AuditAnchor, AuditAnchoring, AuditAnchorMismatch, HmacAuditCheckpointSigner } from '@pragmatic-tech-ai/todl-identity-host'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlAuditStore } from '../sql-audit-store.js'
import { SqlAuditCheckpointStore } from '../sql-audit-checkpoint-store.js'

class SqlAnchoringFixtures
{
    private static readonly Key = 'test-key'

    public static Event(tenant: string, action: string): AuditEvent
    {
        return new AuditEvent(AuditEventKind.AdminAction, tenant, 'p1', new Date('2026-01-01T00:00:00Z'), new Map([['action', action]]))
    }

    public static async Anchoring(session: ISqlSession, interval = 1): Promise<AuditAnchoring>
    {
        return new AuditAnchoring(new AuditAnchor(new HmacAuditCheckpointSigner(SqlAnchoringFixtures.Key), interval), await SqlAuditCheckpointStore.Open(session))
    }
}

SqlTestSessions.Describe('SqlAuditStore anchoring', (makeSession, backend) =>
{
    test(`${backend}: anchored records reopen clean`, async () =>
    {
        const session = await makeSession()
        const t = `t-${randomUUID()}`
        const store = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        await store.Record(SqlAnchoringFixtures.Event(t, 'a'))
        await store.Record(SqlAnchoringFixtures.Event(t, 'b'))
        const reopened = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        assert.ok(reopened.Verify(t))
        assert.equal(reopened.Records(t).length, 2)
    })

    test(`${backend}: tail-truncation (DELETE high seq) is detected on reopen`, async () =>
    {
        const session = await makeSession()
        const t = `t-${randomUUID()}`
        const store = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        await store.Record(SqlAnchoringFixtures.Event(t, 'a'))
        await store.Record(SqlAnchoringFixtures.Event(t, 'b'))
        await store.Record(SqlAnchoringFixtures.Event(t, 'c'))
        // seq is 0-based; delete only the last row (seq 2) so seq 0 and 1 survive — a real tail cut, not truncate-to-zero
        await session.Execute('DELETE FROM identity_audit WHERE tenant_id = $1 AND seq >= $2', [t, 2])
        await assert.rejects(SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session)), AuditAnchorMismatch)
    })

    test(`${backend}: deleting all of a tenant's rows is detected (truncate-to-zero)`, async () =>
    {
        const session = await makeSession()
        const t = `t-${randomUUID()}`
        const store = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        await store.Record(SqlAnchoringFixtures.Event(t, 'a'))
        await session.Execute('DELETE FROM identity_audit WHERE tenant_id = $1', [t])
        await assert.rejects(SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session)), AuditAnchorMismatch)
    })

    test(`${backend}: a forged checkpoint signature is rejected`, async () =>
    {
        const session = await makeSession()
        const t = `t-${randomUUID()}`
        const store = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        await store.Record(SqlAnchoringFixtures.Event(t, 'a'))
        await session.Execute('UPDATE identity_audit_anchor SET signature = $1 WHERE tenant_id = $2', ['deadbeef', t])
        await assert.rejects(SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session)), AuditAnchorMismatch)
    })

    test(`${backend}: anchoring off creates no anchor table and is byte-unchanged`, async () =>
    {
        const session = await makeSession()
        const t = `t-${randomUUID()}`
        const store = await SqlAuditStore.Open(session)
        await store.Record(SqlAnchoringFixtures.Event(t, 'a'))
        await assert.rejects(session.Query('SELECT * FROM identity_audit_anchor', []))
        const reopened = await SqlAuditStore.Open(session)
        assert.ok(reopened.Verify(t))
    })

    test(`${backend}: concurrent Records are serialized per tenant and reopen clean`, async () =>
    {
        const session = await makeSession()
        const t = `t-${randomUUID()}`
        const store = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        await Promise.all([store.Record(SqlAnchoringFixtures.Event(t, 'a')), store.Record(SqlAnchoringFixtures.Event(t, 'b')), store.Record(SqlAnchoringFixtures.Event(t, 'c'))])
        assert.equal(store.Records(t).length, 3)
        const reopened = await SqlAuditStore.Open(session, await SqlAnchoringFixtures.Anchoring(session))
        assert.ok(reopened.Verify(t))
        assert.equal(reopened.Records(t).length, 3)
    })
})
