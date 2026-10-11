import { newDb } from 'pg-mem'
import { Pool } from 'pg'
import type { ISqlSession } from '@pragmatic-tech-ai/todl'
import { PgSession } from '../sql/pg-session.js'

/** Runs a store's test body against an always-on pg-mem session and, when PRAGMATIC_TEST_PG_URL is set and
 *  non-empty, a gated-live real-Postgres session. `body` receives a `makeSession` that yields a FRESH session
 *  (fresh empty pg-mem db per call); it registers node:test cases, labelled by backend. Live tests should use
 *  per-test-unique tenant ids (the stores are tenant-scoped) since a live db is not reset between cases. */
export class SqlTestSessions
{
    private static readonly LiveEnvVar = 'PRAGMATIC_TEST_PG_URL'
    private static readonly MemLabel = 'pg-mem'
    private static readonly LiveLabel = 'live'

    public static Describe(label: string, body: (makeSession: () => Promise<ISqlSession>, backend: string) => void): void
    {
        body(() => Promise.resolve(new PgSession(SqlTestSessions.MemPool())), `${label} [${SqlTestSessions.MemLabel}]`)
        const url = process.env[SqlTestSessions.LiveEnvVar] ?? ''
        if (url !== '')
        {
            body(() => Promise.resolve(new PgSession(new Pool({ connectionString: url }))), `${label} [${SqlTestSessions.LiveLabel}]`)
        }
    }

    private static MemPool(): Pool
    {
        const db = newDb()
        const pg = db.adapters.createPg()
        return new pg.Pool() as unknown as Pool
    }
}
