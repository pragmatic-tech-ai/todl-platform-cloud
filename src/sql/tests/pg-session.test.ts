import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import type { Pool } from 'pg'
import { PgSession } from '../pg-session.js'

class SessionFixture
{
    public static Mem(): PgSession
    {
        const db = newDb()
        const pg = db.adapters.createPg()
        const pool = new pg.Pool() as unknown as Pool
        return new PgSession(pool)
    }
}

test('Execute creates a table and inserts; Query reads it back with positional params', async () =>
{
    const session = SessionFixture.Mem()
    await session.Execute('CREATE TABLE IF NOT EXISTS t (id text primary key, n integer)', [])
    await session.Execute('INSERT INTO t (id, n) VALUES ($1, $2)', ['a', 1])
    const rows = await session.Query('SELECT id, n FROM t WHERE id = $1', ['a'])
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.id, 'a')
    assert.equal(Number(rows[0]!.n), 1)
})

test('Execute returns the affected-row count', async () =>
{
    const session = SessionFixture.Mem()
    await session.Execute('CREATE TABLE IF NOT EXISTS t (id text primary key)', [])
    await session.Execute('INSERT INTO t (id) VALUES ($1)', ['a'])
    const affected = await session.Execute('DELETE FROM t WHERE id = $1', ['a'])
    assert.equal(affected, 1)
})

test('Query against a missing table surfaces the error (not swallowed)', async () =>
{
    const session = SessionFixture.Mem()
    await assert.rejects(() => session.Query('SELECT * FROM nope', []))
})
