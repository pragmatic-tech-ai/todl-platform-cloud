import { randomBytes, createHash } from 'node:crypto'
import type { ISqlSession } from '@pragmatic-tech-ai/todl'
import { Session, AuthMethod } from '@pragmatic-tech-ai/todl-identity'
import type { Principal, ISessionManager } from '@pragmatic-tech-ai/todl-identity'

/** Postgres-backed session manager. Mirrors FileSessionStore: a 32-byte base64url token stored by its
 *  sha256(base64url) hash (Session.Id is the raw token, never stored); TTL default 3_600_000 ms, injectable
 *  clock; an expired session validates to null and is deleted; AuthMethod is always Local. */
export class SqlSessionStore implements ISessionManager
{
    private static readonly Table = 'identity_sessions'
    private static readonly DefaultTtlMs = 3_600_000
    private static readonly TokenBytes = 32
    private static readonly TokenEncoding = 'base64url'
    private static readonly HashAlgorithm = 'sha256'
    private static readonly HashEncoding = 'base64url'

    private readonly session: ISqlSession
    private readonly ttlMs: number
    private readonly now: () => Date

    private constructor(session: ISqlSession, ttlMs: number, now: () => Date)
    {
        this.session = session
        this.ttlMs = ttlMs
        this.now = now
    }

    public static async Open(session: ISqlSession, ttlMs: number = SqlSessionStore.DefaultTtlMs, now: () => Date = () => new Date()): Promise<SqlSessionStore>
    {
        await session.Execute(`CREATE TABLE IF NOT EXISTS ${SqlSessionStore.Table} (hash text PRIMARY KEY, principal_id text, tenant_id text, issued_at text, expires_at text)`, [])
        return new SqlSessionStore(session, ttlMs, now)
    }

    public async Issue(principal: Principal): Promise<Session>
    {
        const token = randomBytes(SqlSessionStore.TokenBytes).toString(SqlSessionStore.TokenEncoding)
        const issuedAt = this.now()
        const expiresAt = new Date(issuedAt.getTime() + this.ttlMs)
        await this.session.Execute(`INSERT INTO ${SqlSessionStore.Table} (hash, principal_id, tenant_id, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5)`, [SqlSessionStore.Hash(token), principal.Id, principal.TenantId, issuedAt.toISOString(), expiresAt.toISOString()])
        return new Session(token, principal.Id, principal.TenantId, issuedAt, expiresAt, AuthMethod.Local)
    }

    public async Validate(token: string): Promise<Session | null>
    {
        const hash = SqlSessionStore.Hash(token)
        const rows = await this.session.Query(`SELECT principal_id, tenant_id, issued_at, expires_at FROM ${SqlSessionStore.Table} WHERE hash = $1`, [hash])
        const row = rows[0]
        if (row === undefined)
        {
            return null
        }
        const result = new Session(token, String(row.principal_id), String(row.tenant_id), new Date(String(row.issued_at)), new Date(String(row.expires_at)), AuthMethod.Local)
        if (result.IsExpired(this.now()))
        {
            await this.session.Execute(`DELETE FROM ${SqlSessionStore.Table} WHERE hash = $1`, [hash])
            return null
        }
        return result
    }

    public async Revoke(sessionId: string): Promise<void>
    {
        await this.session.Execute(`DELETE FROM ${SqlSessionStore.Table} WHERE hash = $1`, [SqlSessionStore.Hash(sessionId)])
    }

    private static Hash(token: string): string
    {
        return createHash(SqlSessionStore.HashAlgorithm).update(token).digest(SqlSessionStore.HashEncoding)
    }
}
