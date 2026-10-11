import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectStoreProviderRegistry } from '../object-store-provider-registry.js'

test('CreateStorage returns a working IStorage rooted at the location', async () =>
{
    const registry = new ObjectStoreProviderRegistry()
    const storage = registry.CreateStorage('tenant-a/packages')
    await storage.WriteText('x.txt', 'hi')
    assert.equal(await storage.ReadText('x.txt'), 'hi')
})

test('the same location returns a store sharing state; distinct locations are isolated', async () =>
{
    const registry = new ObjectStoreProviderRegistry()
    const a1 = registry.CreateStorage('loc/a')
    await a1.WriteText('k', '1')
    const a2 = registry.CreateStorage('loc/a')
    assert.equal(await a2.ReadText('k'), '1')
    const b = registry.CreateStorage('loc/b')
    assert.equal(await b.Exists('k'), false)
})
