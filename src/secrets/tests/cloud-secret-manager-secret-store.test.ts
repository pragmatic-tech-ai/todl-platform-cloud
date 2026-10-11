import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CloudSecretManagerSecretStore } from '../cloud-secret-manager-secret-store.js'

test('Get on a missing reference returns null', async () =>
{
    const store = new CloudSecretManagerSecretStore()
    assert.equal(await store.Get('absent'), null)
})

test('Put then Get round-trips, and Put overwrites', async () =>
{
    const store = new CloudSecretManagerSecretStore()
    await store.Put('db/password', 'p1')
    assert.equal(await store.Get('db/password'), 'p1')
    await store.Put('db/password', 'p2')
    assert.equal(await store.Get('db/password'), 'p2')
})

test('Delete removes a reference; Get then returns null; deleting a missing reference is a no-op', async () =>
{
    const store = new CloudSecretManagerSecretStore()
    await store.Put('k', 'v')
    await store.Delete('k')
    assert.equal(await store.Get('k'), null)
    await store.Delete('k')
})
