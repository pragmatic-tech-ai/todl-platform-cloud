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
})
