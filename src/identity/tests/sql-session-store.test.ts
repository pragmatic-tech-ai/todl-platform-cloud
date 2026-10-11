import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Principal, PrincipalKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlSessionStore } from '../sql-session-store.js'

SqlTestSessions.Describe('SqlSessionStore', (makeSession, backend) =>
{
    test(`${backend}: Issue then Validate round-trips; the raw token is not stored`, async () =>
    {
        const principal = new Principal('p1', `sess-${randomUUID()}`, PrincipalKind.User, new Map(), [])
        const session = await makeSession()
        const store = await SqlSessionStore.Open(session)
        const issued = await store.Issue(principal)
        assert.equal(issued.PrincipalId, 'p1')
        const validated = await store.Validate(issued.Id)
        assert.equal(validated!.PrincipalId, 'p1')
        const rows = await session.Query('SELECT hash FROM identity_sessions', [])
        assert.equal(rows.some(r => String(r.hash) === issued.Id), false)
    })

    test(`${backend}: an expired session validates to null and a revoked session is gone`, async () =>
    {
        const principal = new Principal('p1', `sess-${randomUUID()}`, PrincipalKind.User, new Map(), [])
        let clock = new Date('2020-01-01T00:00:00Z')
        const store = await SqlSessionStore.Open(await makeSession(), 1000, () => clock)
        const issued = await store.Issue(principal)
        clock = new Date('2020-01-01T00:00:02Z')
        assert.equal(await store.Validate(issued.Id), null)
        const live = await SqlSessionStore.Open(await makeSession())
        const s2 = await live.Issue(principal)
        await live.Revoke(s2.Id)
        assert.equal(await live.Validate(s2.Id), null)
    })
})
