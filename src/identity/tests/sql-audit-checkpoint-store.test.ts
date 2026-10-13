import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AuditCheckpoint } from '@pragmatic-tech-ai/todl-identity-host'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlAuditCheckpointStore } from '../sql-audit-checkpoint-store.js'

SqlTestSessions.Describe('SqlAuditCheckpointStore', (makeSession, backend) =>
{
    test(`${backend}: append + latest-by-seq + tenants, surviving a reopen`, async () =>
    {
        const session = await makeSession()
        const t1 = `t-${randomUUID()}`
        const t2 = `t-${randomUUID()}`
        const store = await SqlAuditCheckpointStore.Open(session)
        await store.Append(new AuditCheckpoint(t1, 1, 'h1', 'a1', 's1'))
        await store.Append(new AuditCheckpoint(t1, 2, 'h2', 'a2', 's2'))
        await store.Append(new AuditCheckpoint(t2, 1, 'h3', 'a3', 's3'))
        const reopened = await SqlAuditCheckpointStore.Open(session)
        assert.equal((await reopened.Latest(t1))!.Sequence, 2)
        assert.equal((await reopened.Latest(t1))!.HeadHash, 'h2')
        assert.equal(await reopened.Latest(`absent-${randomUUID()}`), undefined)
        const tenants = await reopened.Tenants()
        assert.ok(tenants.includes(t1) && tenants.includes(t2))
    })
})
