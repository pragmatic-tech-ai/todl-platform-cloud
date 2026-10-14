import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Grant, Role, ResourceRef, ResourceKind, Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlRoleGrantStore } from '../sql-role-grant-store.js'

SqlTestSessions.Describe('SqlRoleGrantStore', (makeSession, backend) =>
{
    const tenant = new Tenant('grant-t1', TenantKind.SelfHosted, 'T1')

    test(`${backend}: GrantsFor ignores the passed tenant and round-trips enums and path`, async () =>
    {
        const p1 = `subj-${randomUUID()}`
        const p2 = `subj-${randomUUID()}`
        const store = await SqlRoleGrantStore.Open(await makeSession())
        await store.Save(new Grant(p1, Role.Owner, new ResourceRef(ResourceKind.Model, 'grant-t1', ['a', 'b'])))
        await store.Save(new Grant(p2, Role.Viewer, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x'])))
        const otherTenant = new Tenant('other-t', TenantKind.SelfHosted, 'OT')
        const grants = await store.GrantsFor(p1, otherTenant)
        assert.equal(grants.length, 1)
        assert.equal(grants[0]!.Role, Role.Owner)
        assert.equal(grants[0]!.Resource.Kind, ResourceKind.Model)
        assert.deepEqual([...grants[0]!.Resource.Path], ['a', 'b'])
        assert.equal(grants[0]!.Resource.TenantId, 'grant-t1')
        const g2 = await store.GrantsFor(p2, otherTenant)
        assert.equal(g2.length, 1)
        assert.equal(g2[0]!.Role, Role.Viewer)
        assert.equal(g2[0]!.Resource.Kind, ResourceKind.Project)
        assert.deepEqual([...g2[0]!.Resource.Path], ['x'])
    })

    test(`${backend}: Save does not dedup identical grants`, async () =>
    {
        const p3 = `subj-${randomUUID()}`
        const store = await SqlRoleGrantStore.Open(await makeSession())
        const grant = new Grant(p3, Role.Editor, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x']))
        await store.Save(grant)
        await store.Save(grant)
        const grants = await store.GrantsFor(p3, tenant)
        assert.equal(grants.length, 2)
        for (const g of grants)
        {
            assert.equal(g.Role, Role.Editor)
            assert.equal(g.Resource.Kind, ResourceKind.Project)
            assert.deepEqual([...g.Resource.Path], ['x'])
        }
    })

    test(`${backend}: Revoke removes the matching grant and leaves a different one`, async () =>
    {
        const p4 = `subj-${randomUUID()}`
        const store = await SqlRoleGrantStore.Open(await makeSession())
        await store.Save(new Grant(p4, Role.Viewer, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x'])))
        await store.Save(new Grant(p4, Role.Editor, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x'])))
        await store.Revoke(new Grant(p4, Role.Editor, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x'])))
        const grants = await store.GrantsFor(p4, tenant)
        assert.equal(grants.length, 1)
        assert.equal(grants[0]!.Role, Role.Viewer)
    })

    test(`${backend}: Revoke on a non-existent grant affects nothing`, async () =>
    {
        const p5 = `subj-${randomUUID()}`
        const store = await SqlRoleGrantStore.Open(await makeSession())
        await store.Save(new Grant(p5, Role.Editor, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x', 'y'])))
        await store.Revoke(new Grant(p5, Role.Editor, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x'])))
        await store.Revoke(new Grant(p5, Role.Owner, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x', 'y'])))
        assert.equal((await store.GrantsFor(p5, tenant)).length, 1)
    })

    test(`${backend}: GrantsOn returns only exact-resource grants for the queried tenant`, async () =>
    {
        const store = await SqlRoleGrantStore.Open(await makeSession())
        const a1 = `subj-${randomUUID()}`
        const a2 = `subj-${randomUUID()}`
        const b1 = `subj-${randomUUID()}`
        await store.Save(new Grant(a1, Role.Admin, new ResourceRef(ResourceKind.Tenant, 'on-t1', [])))
        await store.Save(new Grant(a2, Role.Viewer, new ResourceRef(ResourceKind.Tenant, 'on-t1', [])))
        await store.Save(new Grant(b1, Role.Admin, new ResourceRef(ResourceKind.Tenant, 'on-t2', [])))
        await store.Save(new Grant(a1, Role.Editor, new ResourceRef(ResourceKind.Project, 'on-t1', ['p'])))
        const grants = await store.GrantsOn(new ResourceRef(ResourceKind.Tenant, 'on-t1', []))
        assert.deepEqual(grants.map(g => g.Subject).sort(), [a1, a2].sort())
        for (const g of grants)
        {
            assert.equal(g.Resource.Kind, ResourceKind.Tenant)
            assert.equal(g.Resource.TenantId, 'on-t1')
            assert.deepEqual([...g.Resource.Path], [])
        }
    })
})
