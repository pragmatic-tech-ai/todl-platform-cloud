import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
        assert.equal(resolved!.PrincipalId, 'svc1')
        const rows = await session.Query('SELECT hash FROM identity_service_tokens', [])
        assert.equal(rows.some(r => String(r.hash) === Token), false)
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
        clock = new Date('2020-01-01T02:00:00Z')
        assert.equal(await store.Resolve(tenant, new PresentedSecret(expiring.Token)), null)
    })
})
