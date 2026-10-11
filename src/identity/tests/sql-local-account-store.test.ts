import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Principal, PrincipalKind, Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlLocalAccountStore } from '../sql-local-account-store.js'

SqlTestSessions.Describe('SqlLocalAccountStore', (makeSession, backend) =>
{
    test(`${backend}: CreateAccount then find by email and principal`, async () =>
    {
        const tenant = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const store = await SqlLocalAccountStore.Open(await makeSession())
        const created = await store.CreateAccount(tenant, 'a@x.io', 'p1', 'ref1')
        assert.equal(created.PrincipalId, 'p1')
        assert.equal((await store.FindByEmail(tenant, 'a@x.io'))!.PrincipalId, 'p1')
        assert.equal((await store.FindByPrincipalId(tenant, 'p1'))!.Email, 'a@x.io')
        assert.equal((await store.Lookup('p1', tenant))!.Id, 'p1')
        assert.equal(await store.FindByEmail(tenant, 'missing@x.io'), null)
    })

    test(`${backend}: duplicate email and duplicate principal are rejected`, async () =>
    {
        const tenant = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const store = await SqlLocalAccountStore.Open(await makeSession())
        await store.CreateAccount(tenant, 'dup@x.io', 'pa', 'r')
        await assert.rejects(() => store.CreateAccount(tenant, 'dup@x.io', 'pb', 'r'), /email already registered/)
        await assert.rejects(() => store.CreateAccount(tenant, 'other@x.io', 'pa', 'r'), /principal already registered/)
    })

    test(`${backend}: the same email in a different tenant is allowed`, async () =>
    {
        const t1 = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const t2 = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T2')
        const store = await SqlLocalAccountStore.Open(await makeSession())
        await store.CreateAccount(t1, 'shared@x.io', 'p1', 'r')
        const created = await store.CreateAccount(t2, 'shared@x.io', 'p1', 'r')
        assert.equal(created.TenantId, t2.Id)
        const found1 = await store.FindByEmail(t1, 'shared@x.io')
        const found2 = await store.FindByEmail(t2, 'shared@x.io')
        assert.notEqual(found1, null)
        assert.notEqual(found2, null)
        assert.equal(found1!.TenantId, t1.Id)
        assert.equal(found2!.TenantId, t2.Id)
    })

    test(`${backend}: GroupsOf returns already-populated groups without the DB`, async () =>
    {
        const tenant = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const store = await SqlLocalAccountStore.Open(await makeSession())
        const principal = new Principal('p1', tenant.Id, PrincipalKind.User, new Map(), ['g1'])
        assert.deepEqual(await store.GroupsOf(principal), ['g1'])
    })

    test(`${backend}: GroupsOf falls back to the DB when groups are empty`, async () =>
    {
        const tenant = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const session = await makeSession()
        const store = await SqlLocalAccountStore.Open(session)
        await store.CreateAccount(tenant, 'g@x.io', 'p1', 'r')
        await session.Execute('UPDATE identity_accounts SET groups = $1 WHERE tenant_id = $2 AND principal_id = $3', [JSON.stringify(['g2']), tenant.Id, 'p1'])
        const principal = new Principal('p1', tenant.Id, PrincipalKind.User, new Map(), [])
        assert.deepEqual(await store.GroupsOf(principal), ['g2'])
    })

    test(`${backend}: GroupsOf for an unknown principal is empty and Lookup is null`, async () =>
    {
        const tenant = new Tenant(`acct-${randomUUID()}`, TenantKind.SelfHosted, 'T1')
        const store = await SqlLocalAccountStore.Open(await makeSession())
        const principal = new Principal('ghost', tenant.Id, PrincipalKind.User, new Map(), [])
        assert.deepEqual(await store.GroupsOf(principal), [])
        assert.equal(await store.Lookup('ghost', tenant), null)
    })
})
