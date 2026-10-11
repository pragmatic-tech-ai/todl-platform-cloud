import type { ISecretStore } from '@pragmatic-tech-ai/todl-identity'

/** In-memory cloud-secret-manager double: an async ISecretStore backed by a reference→secret map, modeling a
 *  remote secret manager (AWS/GCP/Azure) without any SDK. Secrets live only in memory for the process; a real
 *  manager backend is a deferred gated-live Feature. Nothing is logged. */
export class CloudSecretManagerSecretStore implements ISecretStore
{
    private readonly secrets = new Map<string, string>()

    public Get(reference: string): Promise<string | null>
    {
        return Promise.resolve(this.secrets.get(reference) ?? null)
    }

    public Put(reference: string, secret: string): Promise<void>
    {
        this.secrets.set(reference, secret)
        return Promise.resolve()
    }

    public Delete(reference: string): Promise<void>
    {
        this.secrets.delete(reference)
        return Promise.resolve()
    }
}
