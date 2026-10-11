import type { ISqlSession } from '@pragmatic-tech-ai/todl'
import { IdentityConfig } from '@pragmatic-tech-ai/todl-identity'
import type { DelegationDepth, Role, ITenantConfigStore } from '@pragmatic-tech-ai/todl-identity'

/** Postgres-backed tenant-config store. Mirrors FileTenantConfigStore: the three ReadonlyMap fields persist
 *  as JSON [key, value] arrays (GroupRoleMap values are integer Role enum values); Save upserts by tenant id. */
export class SqlTenantConfigStore implements ITenantConfigStore
{
    private static readonly Table = 'identity_tenant_config'

    private readonly session: ISqlSession

    private constructor(session: ISqlSession)
    {
        this.session = session
    }

    public static async Open(session: ISqlSession): Promise<SqlTenantConfigStore>
    {
        await session.Execute(`CREATE TABLE IF NOT EXISTS ${SqlTenantConfigStore.Table} (tenant_id text PRIMARY KEY, pack_id text NOT NULL, delegation_depth integer NOT NULL, provider_settings text NOT NULL, group_role_map text NOT NULL, claims_mapping text NOT NULL)`, [])
        return new SqlTenantConfigStore(session)
    }

    public async Get(tenantId: string): Promise<IdentityConfig | null>
    {
        const rows = await this.session.Query(`SELECT pack_id, delegation_depth, provider_settings, group_role_map, claims_mapping FROM ${SqlTenantConfigStore.Table} WHERE tenant_id = $1`, [tenantId])
        const row = rows[0]
        if (row === undefined)
        {
            return null
        }
        return new IdentityConfig(String(row.pack_id), Number(row.delegation_depth) as DelegationDepth, SqlTenantConfigStore.ToStringMap(row.provider_settings), SqlTenantConfigStore.ToRoleMap(row.group_role_map), SqlTenantConfigStore.ToStringMap(row.claims_mapping))
    }

    public async Save(tenantId: string, config: IdentityConfig): Promise<void>
    {
        await this.session.Execute(`INSERT INTO ${SqlTenantConfigStore.Table} (tenant_id, pack_id, delegation_depth, provider_settings, group_role_map, claims_mapping) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id) DO UPDATE SET pack_id = $2, delegation_depth = $3, provider_settings = $4, group_role_map = $5, claims_mapping = $6`, [tenantId, config.PackId, config.DelegationDepth, JSON.stringify([...config.ProviderSettings]), JSON.stringify([...config.GroupRoleMap]), JSON.stringify([...config.ClaimsMapping])])
    }

    public async List(): Promise<readonly string[]>
    {
        const rows = await this.session.Query(`SELECT tenant_id FROM ${SqlTenantConfigStore.Table}`, [])
        return rows.map(row => String(row.tenant_id))
    }

    private static ToStringMap(value: unknown): ReadonlyMap<string, string>
    {
        return new Map(JSON.parse(String(value)) as Array<[string, string]>)
    }

    private static ToRoleMap(value: unknown): ReadonlyMap<string, Role>
    {
        return new Map(JSON.parse(String(value)) as Array<[string, Role]>)
    }
}
