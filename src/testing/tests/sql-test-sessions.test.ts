import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SqlTestSessions } from '../sql-test-sessions.js'

test('Describe invokes the body once for pg-mem when the live env var is unset', () =>
{
    const saved = process.env.PRAGMATIC_TEST_PG_URL
    delete process.env.PRAGMATIC_TEST_PG_URL
    try
    {
        const backends: string[] = []
        SqlTestSessions.Describe('X', (_makeSession, backend) =>
        {
            backends.push(backend)
        })
        assert.equal(backends.length, 1)
        assert.ok(backends[0]!.endsWith('[pg-mem]'))
    }
    finally
    {
        if (saved !== undefined) process.env.PRAGMATIC_TEST_PG_URL = saved
    }
})
