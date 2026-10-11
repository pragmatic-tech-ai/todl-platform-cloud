import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { IdentityConfig, DelegationDepth, Role } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlTenantConfigStore } from '../sql-tenant-config-store.js'

SqlTestSessions.Describe('SqlTenantConfigStore', (makeSession, backend) =>
{
    const config = () => new IdentityConfig('pack-1', DelegationDepth.FullAuthz, new Map([['s', 'v']]), new Map([['grp', Role.Editor]]), new Map([['email', 'email']]))

    test(`${backend}: Save then Get round-trips all map fields; Get missing is null`, async () =>
    {
        const tid = `cfg-${randomUUID()}`
        const store = await SqlTenantConfigStore.Open(await makeSession())
        assert.equal(await store.Get(tid), null)
        await store.Save(tid, config())
        const got = (await store.Get(tid))!
        assert.equal(got.PackId, 'pack-1')
        assert.equal(got.DelegationDepth, DelegationDepth.FullAuthz)
        assert.equal(got.ProviderSettings.get('s'), 'v')
        assert.equal(got.GroupRoleMap.get('grp'), Role.Editor)
        assert.equal(got.ClaimsMapping.get('email'), 'email')
    })

    test(`${backend}: Save upserts and List returns saved tenant ids`, async () =>
    {
        const tid = `cfg-${randomUUID()}`
        const store = await SqlTenantConfigStore.Open(await makeSession())
        await store.Save(tid, config())
        await store.Save(tid, new IdentityConfig('pack-2', DelegationDepth.AuthnDirectory, new Map(), new Map(), new Map()))
        assert.equal((await store.Get(tid))!.PackId, 'pack-2')
        assert.ok((await store.List()).includes(tid))
    })
})
