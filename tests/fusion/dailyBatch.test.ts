import test from 'node:test'
import assert from 'node:assert/strict'
import { runDailyBatch } from '../../server/fusion/dailyBatch.ts'
import type { DailyBatchSource } from '../../server/fusion/dailyBatch.ts'

test('daily scan advances past a full failed batch and later retries failures without starving healthy projects', async () => {
  let cursor: string | null = null
  const rows = Array.from({ length: 21 }, (_, i) => ({ _id: String(i).padStart(3, '0'), projectId: `project-${i}` }))
  const closed: string[] = [], allowed = new Set(rows.map(row => row.projectId))
  let failing = true
  const source: DailyBatchSource = {
    cursor: async () => cursor,
    list: async (after, limit) => rows.filter(row => (after === null || row._id > after) && !closed.includes(row.projectId)).slice(0, limit),
    checkpoint: async after => { cursor = after },
    close: async id => { if (failing && id !== 'project-20') throw Error('BAD_PROJECT'); closed.push(id) },
  }
  assert.equal((await runDailyBatch(source, allowed)).failed, 20)
  assert.equal(cursor, '019')
  assert.equal((await runDailyBatch(source, allowed)).completed, 1)
  assert.deepEqual(closed, ['project-20'])
  failing = false
  assert.equal((await runDailyBatch(source, allowed)).completed, 20)
  assert.equal(new Set(closed).size, 21)
  assert.equal((await runDailyBatch(source, allowed)).completed, 0)
  assert.equal(cursor, null)
})

test('daily scan advances over unauthorized candidates without touching their project', async () => {
  let cursor: string | null = null, touched = false
  const result = await runDailyBatch({
    cursor: async () => cursor, list: async () => [{ _id: 'bad', projectId: 'production-project' }],
    checkpoint: async after => { cursor = after }, close: async () => { touched = true },
  }, new Set())
  assert.equal(result.failed, 1); assert.equal(touched, false); assert.equal(cursor, 'bad')
})
