import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { Tenant, TenantKind, PresentedSecret } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlServiceTokenStore } from '../sql-service-token-store.js'

SqlTestSessions.Describe('SqlServiceTokenStore', (makeSession, backend) =>
{
    test(`${backend}: Issue then Resolve round-trips; the raw token is never stored`, async () =>
    {
        const tenant = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const session = await makeSession()
        const store = await SqlServiceTokenStore.Open(session)
        const { Grant, Token } = await store.Issue(tenant, 'svc1', ['read'], null)
        assert.equal(Grant.PrincipalId, 'svc1')
        const resolved = await store.Resolve(tenant, new PresentedSecret(Token))
        assert.ok(resolved)
        assert.equal(resolved.PrincipalId, 'svc1')
        assert.deepEqual(resolved.Scopes, ['read'])
        const rows = await session.Query('SELECT * FROM identity_service_tokens WHERE tenant_id = $1', [tenant.Id])
        assert.equal(rows.length, 1)
        assert.equal(JSON.stringify(rows).includes(Token), false)
        const hash = createHash('sha256').update(Token).digest('base64url')
        assert.equal(String(rows[0]!.hash), hash)
        assert.equal(Grant.TokenRef, `${tenant.Id}/svctok/${hash}`)
    })

    test(`${backend}: resolve rejects unknown, revoked, wrong-tenant, and expired tokens`, async () =>
    {
        const tenant = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const other = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T2')
        let clock = new Date('2020-01-01T00:00:00Z')
        const session = await makeSession()
        const store = await SqlServiceTokenStore.Open(session, () => clock)
        assert.equal(await store.Resolve(tenant, new PresentedSecret('bogus')), null)
        const live = await store.Issue(tenant, 'svc1', [], null)
        assert.equal(await store.Resolve(other, new PresentedSecret(live.Token)), null)
        await store.Revoke(tenant, live.Grant.TokenRef)
        assert.equal(await store.Resolve(tenant, new PresentedSecret(live.Token)), null)
        const expiring = await store.Issue(tenant, 'svc2', [], new Date('2020-01-01T01:00:00Z'))
        const before = await store.Resolve(tenant, new PresentedSecret(expiring.Token))
        assert.notEqual(before, null)
        clock = new Date('2020-01-01T02:00:00Z')
        assert.equal(await store.Resolve(tenant, new PresentedSecret(expiring.Token)), null)
    })

    test(`${backend}: a token is expired at exactly its expiry instant`, async () =>
    {
        const tenant = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        let clock = new Date('2020-01-01T00:00:00Z')
        const store = await SqlServiceTokenStore.Open(await makeSession(), () => clock)
        const issued = await store.Issue(tenant, 'svc1', [], new Date('2020-01-01T01:00:00Z'))
        clock = new Date('2020-01-01T01:00:00Z')
        assert.equal(await store.Resolve(tenant, new PresentedSecret(issued.Token)), null)
    })

    test(`${backend}: revoking with the wrong tenant does not revoke the token`, async () =>
    {
        const tenant = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const other = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T2')
        const store = await SqlServiceTokenStore.Open(await makeSession())
        const issued = await store.Issue(tenant, 'svc1', [], null)
        await store.Revoke(other, issued.Grant.TokenRef)
        assert.notEqual(await store.Resolve(tenant, new PresentedSecret(issued.Token)), null)
    })

    test(`${backend}: List is tenant-isolated, reflects revocation, and exposes no token value`, async () =>
    {
        const t1 = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const t2 = new Tenant(`tok-${randomUUID()}`, TenantKind.SelfHosted, 'T2')
        const store = await SqlServiceTokenStore.Open(await makeSession())
        const expires = new Date('2099-01-01T00:00:00Z')
        const a = await store.Issue(t1, 'svc1', ['read', 'write'], expires)
        const b = await store.Issue(t1, 'svc2', [], null)
        await store.Issue(t2, 'svc3', ['x'], null)
        await store.Revoke(t1, b.Grant.TokenRef)
        const listed = await store.List(t1)
        assert.equal(listed.length, 2)
        const first = listed.find(s => s.TokenRef === a.Grant.TokenRef)!
        assert.equal(first.PrincipalId, 'svc1')
        assert.deepEqual(first.Scopes, ['read', 'write'])
        assert.equal(first.ExpiresAt!.getTime(), expires.getTime())
        assert.equal(first.Revoked, false)
        const second = listed.find(s => s.TokenRef === b.Grant.TokenRef)!
        assert.equal(second.ExpiresAt, null)
        assert.equal(second.Revoked, true)
        assert.equal(JSON.stringify(listed).includes(a.Token), false)
        const other = await store.List(t2)
        assert.equal(other.length, 1)
        assert.equal(other[0]!.PrincipalId, 'svc3')
    })
})
