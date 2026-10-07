import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshSignals } from '../../src/fusion/refreshSignals.ts'

test('online and foreground hints coalesce while refresh runs; cleanup removes all wakeups', async () => {
  let poll: (() => void) | undefined, cleared = false, calls = 0, release!: () => void
  const win = Object.assign(new EventTarget(), {
    setInterval: (callback: TimerHandler) => { if (typeof callback !== 'function') throw Error('EXPECTED_CALLBACK'); poll = () => callback(); return 1 },
    clearInterval: () => { cleared = true },
  })
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  const stop = refreshSignals(async () => { calls++; await new Promise<void>(resolve => { release = resolve }) }, win, doc)
  win.dispatchEvent(new Event('online')); poll!(); doc.dispatchEvent(new Event('visibilitychange'))
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1)
  release(); await new Promise(resolve => setImmediate(resolve))
  doc.visibilityState = 'hidden'; win.dispatchEvent(new Event('online')); poll!()
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1)
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'))
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2)
  stop(); release(); await new Promise(resolve => setImmediate(resolve))
  win.dispatchEvent(new Event('online')); doc.dispatchEvent(new Event('visibilitychange')); poll!()
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2); assert.equal(cleared, true)
})

test('stopping immediately after an online event cancels its queued refresh', async () => {
  let calls = 0
  const win = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval: () => {} })
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  const stop = refreshSignals(async () => { calls++ }, win, doc)
  win.dispatchEvent(new Event('online')); stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 0)
})
