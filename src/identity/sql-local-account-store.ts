import type { ISqlSession, SqlRow } from '@pragmatic-tech-ai/todl'
import { Principal, PrincipalKind, LocalAccount, LocalAccountNotFoundError } from '@pragmatic-tech-ai/todl-identity'
import type { Tenant, ILocalAccountStore, IPrincipalDirectory } from '@pragmatic-tech-ai/todl-identity'

/** Postgres-backed local account store (+ principal directory). One row per (tenant_id, principal_id); email
 *  is unique within a tenant. Mirrors FileAccountStore: duplicate email OR principal within a tenant is
 *  rejected (pre-checked), groups persist as a JSON array, secrets stay by reference (secret_ref). */
export class SqlLocalAccountStore implements ILocalAccountStore, IPrincipalDirectory
{
    private static readonly Table = 'identity_accounts'
    private static readonly DuplicateEmailMessage = 'email already registered'
    private static readonly DuplicatePrincipalMessage = 'principal already registered'

    private readonly session: ISqlSession

    private constructor(session: ISqlSession)
    {
        this.session = session
    }

    public static async Open(session: ISqlSession): Promise<SqlLocalAccountStore>
    {
        await session.Execute(`CREATE TABLE IF NOT EXISTS ${SqlLocalAccountStore.Table} (tenant_id text, principal_id text, email text, secret_ref text, groups text, disabled boolean NOT NULL DEFAULT false, PRIMARY KEY (tenant_id, principal_id), UNIQUE (tenant_id, email))`, [])
        return new SqlLocalAccountStore(session)
    }

    public async CreateAccount(tenant: Tenant, email: string, principalId: string, secretRef: string): Promise<LocalAccount>
    {
        if (await this.FindByEmail(tenant, email) !== null)
        {
            throw new Error(SqlLocalAccountStore.DuplicateEmailMessage)
        }
        if (await this.FindByPrincipalId(tenant, principalId) !== null)
        {
            throw new Error(SqlLocalAccountStore.DuplicatePrincipalMessage)
        }
        await this.session.Execute(`INSERT INTO ${SqlLocalAccountStore.Table} (tenant_id, principal_id, email, secret_ref, groups, disabled) VALUES ($1, $2, $3, $4, $5, $6)`, [tenant.Id, principalId, email, secretRef, JSON.stringify([]), false])
        return new LocalAccount(principalId, tenant.Id, email, secretRef, false)
    }

    public async FindByEmail(tenant: Tenant, email: string): Promise<LocalAccount | null>
    {
        const rows = await this.session.Query(`SELECT tenant_id, principal_id, email, secret_ref, disabled FROM ${SqlLocalAccountStore.Table} WHERE tenant_id = $1 AND email = $2`, [tenant.Id, email])
        return SqlLocalAccountStore.ToAccount(rows[0])
    }

    public async FindByPrincipalId(tenant: Tenant, principalId: string): Promise<LocalAccount | null>
    {
        const rows = await this.session.Query(`SELECT tenant_id, principal_id, email, secret_ref, disabled FROM ${SqlLocalAccountStore.Table} WHERE tenant_id = $1 AND principal_id = $2`, [tenant.Id, principalId])
        return SqlLocalAccountStore.ToAccount(rows[0])
    }

    public async Disable(tenant: Tenant, principalId: string): Promise<void>
    {
        const changed = await this.session.Execute(`UPDATE ${SqlLocalAccountStore.Table} SET disabled = true WHERE tenant_id = $1 AND principal_id = $2`, [tenant.Id, principalId])
        if (changed === 0)
        {
            throw new LocalAccountNotFoundError(principalId)
        }
    }

    public async ListAccounts(tenant: Tenant): Promise<readonly LocalAccount[]>
    {
        const rows = await this.session.Query(`SELECT tenant_id, principal_id, email, secret_ref, disabled FROM ${SqlLocalAccountStore.Table} WHERE tenant_id = $1`, [tenant.Id])
        return rows.map(row => SqlLocalAccountStore.ToAccount(row)!)
    }

    public async Lookup(principalId: string, tenant: Tenant): Promise<Principal | null>
    {
        const rows = await this.session.Query(`SELECT groups FROM ${SqlLocalAccountStore.Table} WHERE tenant_id = $1 AND principal_id = $2 AND disabled = false`, [tenant.Id, principalId])
        if (rows[0] === undefined)
        {
            return null
        }
        return new Principal(principalId, tenant.Id, PrincipalKind.User, new Map(), SqlLocalAccountStore.Groups(rows[0]))
    }

    public async GroupsOf(principal: Principal): Promise<readonly string[]>
    {
        if (principal.Groups.length > 0)
        {
            return principal.Groups
        }
        const rows = await this.session.Query(`SELECT groups FROM ${SqlLocalAccountStore.Table} WHERE tenant_id = $1 AND principal_id = $2`, [principal.TenantId, principal.Id])
        return rows[0] === undefined ? [] : SqlLocalAccountStore.Groups(rows[0])
    }

    private static ToAccount(row: SqlRow | undefined): LocalAccount | null
    {
        if (row === undefined)
        {
            return null
        }
        return new LocalAccount(String(row.principal_id), String(row.tenant_id), String(row.email), String(row.secret_ref), row.disabled === true)
    }

    private static Groups(row: SqlRow): readonly string[]
    {
        return JSON.parse(String(row.groups)) as readonly string[]
    }
}
