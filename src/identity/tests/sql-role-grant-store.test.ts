import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Grant, Role, ResourceRef, ResourceKind, Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import { SqlTestSessions } from '../../testing/sql-test-sessions.js'
import { SqlRoleGrantStore } from '../sql-role-grant-store.js'

SqlTestSessions.Describe('SqlRoleGrantStore', (makeSession, backend) =>
{
    const tenant = new Tenant('grant-t1', TenantKind.SelfHosted, 'T1')

    test(`${backend}: Save then GrantsFor returns the subject's grants (tenant ignored in lookup)`, async () =>
    {
        const p1 = `subj-${randomUUID()}`
        const p2 = `subj-${randomUUID()}`
        const store = await SqlRoleGrantStore.Open(await makeSession())
        await store.Save(new Grant(p1, Role.Owner, new ResourceRef(ResourceKind.Tenant, 'grant-t1', [])))
        await store.Save(new Grant(p2, Role.Viewer, new ResourceRef(ResourceKind.Model, 'grant-t1', ['m'])))
        const grants = await store.GrantsFor(p1, tenant)
        assert.equal(grants.length, 1)
        assert.equal(grants[0]!.Role, Role.Owner)
        assert.equal(grants[0]!.Resource.Kind, ResourceKind.Tenant)
        assert.deepEqual([...grants[0]!.Resource.Path], [])
    })

    test(`${backend}: Save does not dedup identical grants`, async () =>
    {
        const p3 = `subj-${randomUUID()}`
        const store = await SqlRoleGrantStore.Open(await makeSession())
        const grant = new Grant(p3, Role.Editor, new ResourceRef(ResourceKind.Project, 'grant-t1', ['x']))
        await store.Save(grant)
        await store.Save(grant)
        assert.equal((await store.GrantsFor(p3, tenant)).length, 2)
    })
})
