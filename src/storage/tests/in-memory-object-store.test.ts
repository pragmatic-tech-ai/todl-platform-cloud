import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStatStorage, isWatchableStorage, isLocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'
import { InMemoryObjectStore } from '../in-memory-object-store.js'

test('text round-trips and Root is the given descriptor', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    assert.equal(store.Root, 'object://bucket')
    await store.WriteText('a/b.txt', 'hello')
    assert.equal(await store.ReadText('a/b.txt'), 'hello')
})

test('bytes round-trip losslessly for all byte values', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    const bytes = Uint8Array.from([0, 1, 127, 128, 200, 255])
    await store.WriteBytes('blob.bin', bytes)
    assert.deepEqual([...(await store.ReadBytes('blob.bin'))], [...bytes])
})

test('reading a missing object rejects', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await assert.rejects(() => store.ReadText('missing'))
})

test('Exists is true for a stored object, a prefix directory, and an explicit empty directory; false otherwise', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await store.WriteText('dir/file.txt', 'x')
    await store.CreateDirectory('empty')
    assert.equal(await store.Exists('dir/file.txt'), true)
    assert.equal(await store.Exists('dir'), true)
    assert.equal(await store.Exists('empty'), true)
    assert.equal(await store.Exists('nope'), false)
})

test('List is non-recursive and prefix-scoped; a missing directory lists empty', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await store.WriteText('top.txt', 'x')
    await store.WriteText('sub/inner.txt', 'y')
    const root = await store.List('')
    assert.deepEqual([...root].map(e => `${e.Name}:${e.IsDirectory}`).sort(), ['sub:true', 'top.txt:false'])
    assert.deepEqual(await store.List('does/not/exist'), [])
})

test('Delete removes a whole subtree', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await store.WriteText('d/a.txt', '1')
    await store.WriteText('d/sub/b.txt', '2')
    await store.Delete('d')
    assert.equal(await store.Exists('d'), false)
    assert.equal(await store.Exists('d/sub/b.txt'), false)
})

test('Rename moves a single object', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await store.WriteText('old.txt', 'v')
    await store.Rename('old.txt', 'new.txt')
    assert.equal(await store.Exists('old.txt'), false)
    assert.equal(await store.ReadText('new.txt'), 'v')
})

test('Rename re-keys an entire folder subtree and nothing outside it', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await store.WriteText('from/a.txt', '1')
    await store.WriteText('from/sub/b.txt', '2')
    await store.WriteText('other/c.txt', '3')
    await store.WriteText('fromother/d.txt', '4')
    await store.Rename('from', 'to')
    assert.equal(await store.ReadText('to/a.txt'), '1')
    assert.equal(await store.ReadText('to/sub/b.txt'), '2')
    assert.equal(await store.Exists('from'), false)
    assert.equal(await store.ReadText('other/c.txt'), '3')
    assert.equal(await store.ReadText('fromother/d.txt'), '4')
})

test('Exists is true for the root even when empty (parity with the real backend)', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    assert.equal(await store.Exists(''), true)
})

test('renaming a folder to the root yields normalized top-level keys (no leading slash)', async () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    await store.WriteText('from/a.txt', '1')
    await store.Rename('from', '')
    assert.equal(await store.ReadText('a.txt'), '1')
    assert.deepEqual([...(await store.List(''))].map(e => e.Name), ['a.txt'])
})

test('it omits the filesystem-only companion capabilities', () =>
{
    const store = new InMemoryObjectStore('object://bucket')
    assert.equal(isStatStorage(store), false)
    assert.equal(isWatchableStorage(store), false)
    assert.equal(isLocalFileAccess(store), false)
})
