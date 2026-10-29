import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { Principal, PrincipalKind, AuthMethod, Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlSessionStore } from '../sql-session-store.js'

SqlTestSessions.Describe('SqlSessionStore', (makeSession, backend) =>
{
    const newPrincipal = (): Principal => new Principal('p1', `sess-${randomUUID()}`, PrincipalKind.User, new Map(), [])
    const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url')

    test(`${backend}: Issue then Validate round-trips; the raw token is not stored`, async () =>
    {
        const principal = newPrincipal()
        const session = await makeSession()
        const store = await SqlSessionStore.Open(session)
        const issued = await store.Issue(principal)
        assert.equal(issued.PrincipalId, 'p1')
        assert.equal(issued.AuthMethod, AuthMethod.Local)
        assert.equal(issued.ExpiresAt.getTime() - issued.IssuedAt.getTime(), 3_600_000)
        const validated = await store.Validate(issued.Id)
        assert.equal(validated!.PrincipalId, 'p1')
        const rows = await session.Query('SELECT * FROM identity_sessions WHERE tenant_id = $1', [principal.TenantId])
        assert.equal(rows.length, 1)
        assert.equal(JSON.stringify(rows).includes(issued.Id), false)
        assert.equal(String(rows[0]!.hash), hashOf(issued.Id))
    })

    test(`${backend}: an expired session validates to null and its row is deleted`, async () =>
    {
        const principal = newPrincipal()
        let clock = new Date('2020-01-01T00:00:00Z')
        const session = await makeSession()
        const store = await SqlSessionStore.Open(session, 1000, () => clock)
        const issued = await store.Issue(principal)
        assert.notEqual(await store.Validate(issued.Id), null)
        clock = new Date('2020-01-01T00:00:02Z')
        assert.equal(await store.Validate(issued.Id), null)
        const rows = await session.Query('SELECT * FROM identity_sessions WHERE tenant_id = $1', [principal.TenantId])
        assert.equal(rows.length, 0)
    })

    test(`${backend}: a revoked session is gone`, async () =>
    {
        const principal = newPrincipal()
        const session = await makeSession()
        const store = await SqlSessionStore.Open(session)
        const issued = await store.Issue(principal)
        await store.Revoke(issued.Id)
        assert.equal(await store.Validate(issued.Id), null)
        const rows = await session.Query('SELECT * FROM identity_sessions WHERE tenant_id = $1', [principal.TenantId])
        assert.equal(rows.length, 0)
    })

    test(`${backend}: a corrupt expiry fails closed and the row is deleted`, async () =>
    {
        const principal = newPrincipal()
        const session = await makeSession()
        const store = await SqlSessionStore.Open(session)
        const issued = await store.Issue(principal)
        await session.Execute('UPDATE identity_sessions SET expires_at = $1 WHERE hash = $2', ['not-a-date', hashOf(issued.Id)])
        assert.equal(await store.Validate(issued.Id), null)
        const rows = await session.Query('SELECT * FROM identity_sessions WHERE tenant_id = $1', [principal.TenantId])
        assert.equal(rows.length, 0)
    })

    test(`${backend}: RevokeAllFor drops every session of one principal and leaves others`, async () =>
    {
        const tenant = `sess-${randomUUID()}`
        const idA = `pA-${randomUUID()}`
        const idB = `pB-${randomUUID()}`
        const a = new Principal(idA, tenant, PrincipalKind.User, new Map(), [])
        const b = new Principal(idB, tenant, PrincipalKind.User, new Map(), [])
        const aOtherTenant = new Principal(idA, `sess-${randomUUID()}`, PrincipalKind.User, new Map(), [])
        const store = await SqlSessionStore.Open(await makeSession())
        const a1 = await store.Issue(a)
        const a2 = await store.Issue(a)
        const b1 = await store.Issue(b)
        const a3 = await store.Issue(aOtherTenant)
        await store.RevokeAllFor(new Tenant(tenant, TenantKind.Saas, 'Acme'), idA)
        assert.equal(await store.Validate(a1.Id), null)
        assert.equal(await store.Validate(a2.Id), null)
        assert.notEqual(await store.Validate(b1.Id), null)
        assert.notEqual(await store.Validate(a3.Id), null)
    })
})
