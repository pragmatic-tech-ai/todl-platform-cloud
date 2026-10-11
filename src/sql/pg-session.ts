import type { Pool } from 'pg'
import type { ISqlSession, SqlRow } from '@pragmatic-tech-ai/todl'

/** A clean ISqlSession over a pg.Pool for the cloud identity stores. Unlike the connectors-host PgSqlSession
 *  it does NOT swallow undefined-table errors: identity tables are created by each store's CREATE TABLE IF
 *  NOT EXISTS bootstrap, so a missing table is a real fault that must surface, never be masked as empty. */
export class PgSession implements ISqlSession
{
    private readonly pool: Pool

    public constructor(pool: Pool)
    {
        this.pool = pool
    }

    public async Query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>
    {
        const result = await this.pool.query(sql, params as unknown[])
        return result.rows as readonly SqlRow[]
    }

    public async Execute(sql: string, params: readonly unknown[]): Promise<number>
    {
        const result = await this.pool.query(sql, params as unknown[])
        return result.rowCount ?? 0
    }

    public async Dispose(): Promise<void>
    {
        await this.pool.end()
    }
}
