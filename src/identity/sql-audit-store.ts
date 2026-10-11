import type { ISqlSession, SqlRow } from '@pragmatic-tech-ai/todl'
import { AuditEvent } from '@pragmatic-tech-ai/todl-identity'
import type { AuditEventKind, IAuditSink } from '@pragmatic-tech-ai/todl-identity'
import { HashChainedAuditSink } from '@pragmatic-tech-ai/todl-identity-host'
import type { ChainedAuditRecord } from '@pragmatic-tech-ai/todl-identity-host'

/** Postgres-backed audit sink. Mirrors FileAuditSink: it persists only the ordered raw event log (per-tenant
 *  sequence) and rebuilds the deterministic hash chain by replaying persisted events through a fresh
 *  HashChainedAuditSink on Open. Record chains in memory then inserts the raw event; Verify/Records delegate. */
export class SqlAuditStore implements IAuditSink
{
    private static readonly Table = 'identity_audit'

    private readonly session: ISqlSession
    private readonly chain: HashChainedAuditSink

    private constructor(session: ISqlSession, chain: HashChainedAuditSink)
    {
        this.session = session
        this.chain = chain
    }

    public static async Open(session: ISqlSession): Promise<SqlAuditStore>
    {
        await session.Execute(`CREATE TABLE IF NOT EXISTS ${SqlAuditStore.Table} (tenant_id text, seq integer, kind integer, principal_id text, at text, detail text)`, [])
        await session.Execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${SqlAuditStore.Table}_pk ON ${SqlAuditStore.Table} (tenant_id, seq)`, [])
        const chain = new HashChainedAuditSink()
        const rows = await session.Query(`SELECT tenant_id, seq, kind, principal_id, at, detail FROM ${SqlAuditStore.Table} ORDER BY tenant_id, seq`, [])
        for (const row of rows)
        {
            await chain.Record(SqlAuditStore.ToEvent(row))
        }
        return new SqlAuditStore(session, chain)
    }

    public async Record(event: AuditEvent): Promise<void>
    {
        await this.chain.Record(event)
        const rows = await this.session.Query(`SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM ${SqlAuditStore.Table} WHERE tenant_id = $1`, [event.TenantId])
        const seq = Number(rows[0]!.next)
        const detail = JSON.stringify([...event.Detail])
        await this.session.Execute(`INSERT INTO ${SqlAuditStore.Table} (tenant_id, seq, kind, principal_id, at, detail) VALUES ($1, $2, $3, $4, $5, $6)`, [event.TenantId, seq, event.Kind, event.PrincipalId, event.At.toISOString(), detail])
    }

    public Verify(tenantId: string): boolean
    {
        return this.chain.Verify(tenantId)
    }

    public Records(tenantId: string): readonly ChainedAuditRecord[]
    {
        return this.chain.Records(tenantId)
    }

    private static ToEvent(row: SqlRow): AuditEvent
    {
        const detail = JSON.parse(String(row.detail)) as Array<[string, string]>
        return new AuditEvent(Number(row.kind) as AuditEventKind, String(row.tenant_id), row.principal_id === null ? null : String(row.principal_id), new Date(String(row.at)), new Map(detail))
    }
}
