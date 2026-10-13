import type { ISqlSession, SqlRow } from '@pragmatic-tech-ai/todl'
import { AuditEvent } from '@pragmatic-tech-ai/todl-identity'
import type { AuditEventKind, IAuditSink } from '@pragmatic-tech-ai/todl-identity'
import { AuditTamperDetected, HashChainedAuditSink } from '@pragmatic-tech-ai/todl-identity-host'
import type { ChainedAuditRecord } from '@pragmatic-tech-ai/todl-identity-host'

/** Postgres-backed audit sink. Persists each event's chain hash and prev_hash alongside the raw event and VERIFIES
 *  them on Open: the chain is recomputed from the persisted events and compared with the persisted hashes. Any
 *  mismatch, or a gap/reorder in the per-tenant sequence, makes Open throw AuditTamperDetected (fail-closed).
 *
 *  Legacy rows written before the hash columns existed (NULL hash) are backfilled on Open, but ONLY as a
 *  pre-migration PREFIX of a tenant's chain: a NULL hash after a hashed row is treated as tamper (otherwise an
 *  attacker could edit a row, null its hashes and have Open re-sign it). Accepted limitation: a crash DURING the
 *  one-time first-upgrade backfill can leave a mixed NULL/hashed chain that then fails Open. Rewriting the whole
 *  table consistently is out of scope here (covered by the external-anchoring Feature).
 *
 *  Record is serialized per tenant through a promise queue. The sequence comes from the in-memory chain (no
 *  MAX(seq) query) and the event is inserted BEFORE it is appended to the chain, so a rejected insert (unique
 *  conflict) never leaves the losing event in the in-memory chain. */
export class SqlAuditStore implements IAuditSink
{
    private static readonly Table = 'identity_audit'
    private static readonly HashColumn = 'hash'
    private static readonly PrevHashColumn = 'prev_hash'
    private static readonly SelectSql = `SELECT tenant_id, seq, kind, principal_id, at, detail, ${SqlAuditStore.HashColumn}, ${SqlAuditStore.PrevHashColumn} FROM ${SqlAuditStore.Table} ORDER BY tenant_id, seq`
    private static readonly UpdateSql = `UPDATE ${SqlAuditStore.Table} SET ${SqlAuditStore.HashColumn} = $1, ${SqlAuditStore.PrevHashColumn} = $2 WHERE tenant_id = $3 AND seq = $4`
    private static readonly InsertSql = `INSERT INTO ${SqlAuditStore.Table} (tenant_id, seq, kind, principal_id, at, detail, ${SqlAuditStore.HashColumn}, ${SqlAuditStore.PrevHashColumn}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

    private readonly session: ISqlSession
    private readonly chain: HashChainedAuditSink
    private readonly writes = new Map<string, Promise<unknown>>()

    private constructor(session: ISqlSession, chain: HashChainedAuditSink)
    {
        this.session = session
        this.chain = chain
    }

    private static AddColumnSql(column: string): string
    {
        return `ALTER TABLE ${SqlAuditStore.Table} ADD COLUMN ${column} text`
    }

    public static async Open(session: ISqlSession): Promise<SqlAuditStore>
    {
        await session.Execute(`CREATE TABLE IF NOT EXISTS ${SqlAuditStore.Table} (tenant_id text, seq integer, kind integer, principal_id text, at text, detail text)`, [])
        await session.Execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${SqlAuditStore.Table}_pk ON ${SqlAuditStore.Table} (tenant_id, seq)`, [])
        for (const column of [SqlAuditStore.HashColumn, SqlAuditStore.PrevHashColumn])
        {
            try
            {
                await session.Execute(SqlAuditStore.AddColumnSql(column), [])
            }
            catch
            {
                // Idempotent migration: a duplicate-column error on reopen is the expected, swallowed case.
            }
        }
        const chain = new HashChainedAuditSink()
        const hashedTenants = new Set<string>()
        const rows = await session.Query(SqlAuditStore.SelectSql, [])
        for (const row of rows)
        {
            const event = SqlAuditStore.ToEvent(row)
            const expected = chain.Next(event.TenantId, event)
            if (Number(row.seq) !== expected.Sequence)
            {
                throw new AuditTamperDetected(event.TenantId, expected.Sequence)
            }
            const hash = row[SqlAuditStore.HashColumn]
            const prevHash = row[SqlAuditStore.PrevHashColumn]
            if (hash === null || hash === undefined)
            {
                if (hashedTenants.has(event.TenantId))
                {
                    throw new AuditTamperDetected(event.TenantId, expected.Sequence)
                }
                await session.Execute(SqlAuditStore.UpdateSql, [expected.Hash, expected.PrevHash, event.TenantId, expected.Sequence])
            }
            else
            {
                if (String(hash) !== expected.Hash || String(prevHash) !== expected.PrevHash)
                {
                    throw new AuditTamperDetected(event.TenantId, expected.Sequence)
                }
                hashedTenants.add(event.TenantId)
            }
            chain.Append(expected)
        }
        return new SqlAuditStore(session, chain)
    }

    public async Record(event: AuditEvent): Promise<void>
    {
        const prior = this.writes.get(event.TenantId) ?? Promise.resolve()
        const mine = prior.then(() => this.DoRecord(event), () => this.DoRecord(event))
        const tail = mine.then(() => undefined, () => undefined)
        this.writes.set(event.TenantId, tail)
        void tail.then(() =>
        {
            if (this.writes.get(event.TenantId) === tail)
            {
                this.writes.delete(event.TenantId)
            }
        })
        await mine
    }

    private async DoRecord(event: AuditEvent): Promise<void>
    {
        const next = this.chain.Next(event.TenantId, event)
        const detail = JSON.stringify([...event.Detail])
        await this.session.Execute(SqlAuditStore.InsertSql, [event.TenantId, next.Sequence, event.Kind, event.PrincipalId, event.At.toISOString(), detail, next.Hash, next.PrevHash])
        this.chain.Append(next)
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
