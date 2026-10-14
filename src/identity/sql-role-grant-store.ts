import type { ISqlSession, SqlRow } from '@pragmatic-tech-ai/todl'
import { Grant, ResourceRef } from '@pragmatic-tech-ai/todl-identity'
import type { Role, ResourceKind, Tenant, IRoleGrantStore } from '@pragmatic-tech-ai/todl-identity'

/** Postgres-backed role-grant store. Mirrors FileRoleGrantStore: GrantsFor filters by SUBJECT only (tenant
 *  ignored), Save APPENDS with no dedup. Role and ResourceKind persist as their integer enum values; the
 *  resource path persists as a JSON array. */
export class SqlRoleGrantStore implements IRoleGrantStore
{
    private static readonly Table = 'identity_role_grants'

    private readonly session: ISqlSession

    private constructor(session: ISqlSession)
    {
        this.session = session
    }

    public static async Open(session: ISqlSession): Promise<SqlRoleGrantStore>
    {
        await session.Execute(`CREATE TABLE IF NOT EXISTS ${SqlRoleGrantStore.Table} (subject text NOT NULL, role integer NOT NULL, resource_kind integer NOT NULL, resource_tenant_id text NOT NULL, resource_path text NOT NULL)`, [])
        return new SqlRoleGrantStore(session)
    }

    public async GrantsFor(subject: string, _tenant: Tenant): Promise<readonly Grant[]>
    {
        // Grant order is not significant: GrantsFor returns an unordered bag the authorization engine scans; a serial column is intentionally avoided (plan's no-serial constraint).
        const rows = await this.session.Query(`SELECT subject, role, resource_kind, resource_tenant_id, resource_path FROM ${SqlRoleGrantStore.Table} WHERE subject = $1`, [subject])
        return rows.map(SqlRoleGrantStore.ToGrant)
    }

    public async Save(grant: Grant): Promise<void>
    {
        await this.session.Execute(`INSERT INTO ${SqlRoleGrantStore.Table} (subject, role, resource_kind, resource_tenant_id, resource_path) VALUES ($1, $2, $3, $4, $5)`, [grant.Subject, grant.Role, grant.Resource.Kind, grant.Resource.TenantId, JSON.stringify([...grant.Resource.Path])])
    }

    public async Revoke(grant: Grant): Promise<void>
    {
        await this.session.Execute(`DELETE FROM ${SqlRoleGrantStore.Table} WHERE subject = $1 AND role = $2 AND resource_kind = $3 AND resource_tenant_id = $4 AND resource_path = $5`, [grant.Subject, grant.Role, grant.Resource.Kind, grant.Resource.TenantId, JSON.stringify([...grant.Resource.Path])])
    }

    private static ToGrant(row: SqlRow): Grant
    {
        return new Grant(String(row.subject), Number(row.role) as Role, new ResourceRef(Number(row.resource_kind) as ResourceKind, String(row.resource_tenant_id), JSON.parse(String(row.resource_path)) as string[]))
    }
}
