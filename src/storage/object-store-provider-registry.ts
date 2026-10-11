import type { IStorageProviderRegistry } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { InMemoryObjectStore } from './in-memory-object-store.js'

/** In-memory object-store provider registry: each distinct location is a separate namespaced bucket, so a
 *  repeated location shares state (like reopening the same bucket prefix) and different locations are fully
 *  isolated. Models a single object-store service handing out per-location namespaces; no real cloud SDK. */
export class ObjectStoreProviderRegistry implements IStorageProviderRegistry
{
    private readonly stores = new Map<string, InMemoryObjectStore>()

    public CreateStorage(location: string): IStorage
    {
        const existing = this.stores.get(location)
        if (existing !== undefined)
        {
            return existing
        }
        const created = new InMemoryObjectStore(location)
        this.stores.set(location, created)
        return created
    }
}
