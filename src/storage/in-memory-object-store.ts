import type { IStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'

/** In-memory object-store double: a flat key→content map with prefix-derived directory listing, modeling
 *  cloud object-store semantics. Implements the full IStorage contract — Rename is emulated by re-keying
 *  (non-atomic, copy-then-delete, as a real object store does) — but implements IStorage ONLY: it omits the
 *  optional IStatStorage/IWatchableStorage/ILocalFileAccess companions a cloud store cannot honor, so the
 *  runtime feature-test guards report false and callers take the object-store-safe path. Content is stored as
 *  a latin1 string (0–255 per char) so bytes and text share one map and WriteBytes round-trips losslessly;
 *  mixed text/bytes access on the same key is faithful only for 0–255 content (callers use one or the other). */
export class InMemoryObjectStore implements IStorage
{
    private static readonly NotFoundPrefix = 'ENOENT: '
    private static readonly Separator = '/'

    public readonly Root: string
    private readonly objects = new Map<string, string>()
    private readonly directories = new Set<string>()

    public constructor(root: string)
    {
        this.Root = root
    }

    public ReadText(path: string): Promise<string>
    {
        const key = InMemoryObjectStore.Normalize(path)
        const value = this.objects.get(key)
        if (value === undefined)
        {
            return Promise.reject(InMemoryObjectStore.NotFound(key))
        }
        return Promise.resolve(value)
    }

    public ReadBytes(path: string): Promise<Uint8Array>
    {
        const key = InMemoryObjectStore.Normalize(path)
        const value = this.objects.get(key)
        if (value === undefined)
        {
            return Promise.reject(InMemoryObjectStore.NotFound(key))
        }
        return Promise.resolve(Uint8Array.from(value, c => c.charCodeAt(0)))
    }

    public WriteText(path: string, content: string): Promise<void>
    {
        this.objects.set(InMemoryObjectStore.Normalize(path), content)
        return Promise.resolve()
    }

    public WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        let content = ''
        for (const byte of bytes)
        {
            content += String.fromCharCode(byte)
        }
        this.objects.set(InMemoryObjectStore.Normalize(path), content)
        return Promise.resolve()
    }

    public Exists(path: string): Promise<boolean>
    {
        const key = InMemoryObjectStore.Normalize(path)
        if (key === '')
        {
            return Promise.resolve(true)
        }
        if (this.objects.has(key) || this.directories.has(key))
        {
            return Promise.resolve(true)
        }
        const prefix = key + InMemoryObjectStore.Separator
        for (const k of this.objects.keys())
        {
            if (k.startsWith(prefix))
            {
                return Promise.resolve(true)
            }
        }
        for (const d of this.directories)
        {
            if (d.startsWith(prefix))
            {
                return Promise.resolve(true)
            }
        }
        return Promise.resolve(false)
    }

    public Delete(path: string): Promise<void>
    {
        const key = InMemoryObjectStore.Normalize(path)
        this.objects.delete(key)
        this.directories.delete(key)
        const prefix = key + InMemoryObjectStore.Separator
        for (const k of [...this.objects.keys()])
        {
            if (k.startsWith(prefix))
            {
                this.objects.delete(k)
            }
        }
        for (const d of [...this.directories])
        {
            if (d.startsWith(prefix))
            {
                this.directories.delete(d)
            }
        }
        return Promise.resolve()
    }

    public CreateDirectory(path: string): Promise<void>
    {
        let key = InMemoryObjectStore.Normalize(path)
        while (key !== '')
        {
            this.directories.add(key)
            key = InMemoryObjectStore.ParentOf(key)
        }
        return Promise.resolve()
    }

    public Rename(from: string, to: string): Promise<void>
    {
        const src = InMemoryObjectStore.Normalize(from)
        const dst = InMemoryObjectStore.Normalize(to)
        for (const [key, value] of [...this.objects])
        {
            const next = InMemoryObjectStore.Rewrite(key, src, dst)
            if (next !== undefined)
            {
                this.objects.delete(key)
                this.objects.set(next, value)
            }
        }
        for (const key of [...this.directories])
        {
            const next = InMemoryObjectStore.Rewrite(key, src, dst)
            if (next !== undefined)
            {
                this.directories.delete(key)
                this.directories.add(next)
            }
        }
        return Promise.resolve()
    }

    public List(path: string): Promise<readonly StorageEntry[]>
    {
        const dir = InMemoryObjectStore.Normalize(path)
        const prefix = dir === '' ? '' : dir + InMemoryObjectStore.Separator
        const children = new Map<string, boolean>()
        for (const key of this.objects.keys())
        {
            InMemoryObjectStore.CollectChild(children, key, prefix, false)
        }
        for (const d of this.directories)
        {
            InMemoryObjectStore.CollectChild(children, d, prefix, true)
        }
        return Promise.resolve([...children].map(([Name, IsDirectory]) => ({ Name, IsDirectory })))
    }

    private static CollectChild(children: Map<string, boolean>, key: string, prefix: string, forceDirectory: boolean): void
    {
        if (!key.startsWith(prefix))
        {
            return
        }
        const rest = key.slice(prefix.length)
        if (rest === '')
        {
            return
        }
        const slash = rest.indexOf(InMemoryObjectStore.Separator)
        if (slash === -1)
        {
            children.set(rest, forceDirectory || (children.get(rest) ?? false))
        }
        else
        {
            children.set(rest.slice(0, slash), true)
        }
    }

    private static Rewrite(key: string, src: string, dst: string): string | undefined
    {
        if (key === src)
        {
            return dst
        }
        if (key.startsWith(src + InMemoryObjectStore.Separator))
        {
            return dst + key.slice(src.length)
        }
        return undefined
    }

    private static NotFound(key: string): Error
    {
        return new Error(`${InMemoryObjectStore.NotFoundPrefix}${key}`)
    }

    private static Normalize(path: string): string
    {
        return path.split(/[\\/]/).filter(s => s.length > 0).join(InMemoryObjectStore.Separator)
    }

    private static ParentOf(key: string): string
    {
        const slash = key.lastIndexOf(InMemoryObjectStore.Separator)
        return slash === -1 ? '' : key.slice(0, slash)
    }
}
