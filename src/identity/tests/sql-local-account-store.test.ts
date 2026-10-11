import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlLocalAccountStore } from '../sql-local-account-store.js'

SqlTestSessions.Describe('SqlLocalAccountStore', (makeSession, backend) =>
{
    const tenant = new Tenant('acct-t1', TenantKind.SelfHosted, 'T1')

    test(`${backend}: CreateAccount then find by email and principal`, async () =>
    {
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
        const store = await SqlLocalAccountStore.Open(await makeSession())
        await store.CreateAccount(tenant, 'dup@x.io', 'pa', 'r')
        await assert.rejects(() => store.CreateAccount(tenant, 'dup@x.io', 'pb', 'r'))
        await assert.rejects(() => store.CreateAccount(tenant, 'other@x.io', 'pa', 'r'))
    })

    test(`${backend}: the same email in a different tenant is allowed`, async () =>
    {
        const store = await SqlLocalAccountStore.Open(await makeSession())
        const t2 = new Tenant('acct-t2', TenantKind.SelfHosted, 'T2')
        await store.CreateAccount(tenant, 'shared@x.io', 'p1', 'r')
        const created = await store.CreateAccount(t2, 'shared@x.io', 'p1', 'r')
        assert.equal(created.TenantId, 'acct-t2')
    })
})
