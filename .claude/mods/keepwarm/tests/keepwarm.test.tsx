import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import type { KeepwarmWatch } from '../types'
import { isCold, isWarmRead, lineOf, nextPingAt, pickTtl } from '../hooks/lib/plan'

const MINUTE = 60_000
const T0 = 10_000_000

const BAND = {
  plugin: 'keepwarm',
  component: 'AbovePrompt',
  viewport: { columns: 170, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// A subscription session (it reports plan limits) whose forks answer from `replies`, in order.
function world(on: On, replies: Usage[]): { clock: MockClock; forks: () => number } {
  const clock = mock.clock(on, { now: T0 })
  let forks = 0
  on('session.start', () => ({ cwd: '/work/app' }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', () => ({ value: { command: 'keepwarm' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 180_000, window: 1_000_000, percent: 18 }, rateLimits: [{ kind: 'five_hour', percentUsed: 4 }] },
  }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', () => {
    const usage = replies[Math.min(forks, replies.length - 1)] ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    forks += 1

    return { value: { isAnswered: true, text: 'ok', usage } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))

  return { clock, forks: () => forks }
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/app' } as const
const DONE = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const
const WARM: Usage = { input_tokens: 20, output_tokens: 2, cache_read_input_tokens: 180_000, cache_creation_input_tokens: 0 }
const REBUILT: Usage = { input_tokens: 20, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 180_000 }

test('after a turn it pings before the cache expires, and goes on until its window ends', { options: { enabled: true, hours: 2 } }, async ($, on) => {
  const { clock, forks } = world(on, [WARM])
  await $.session.start(START)
  await $.turn.start({ text: 'hi', turnId: 'turn-1' })
  await $.turn.complete(DONE)

  await clock.advance(49 * MINUTE)
  expect(forks()).toBe(0)
  await clock.advance(2 * MINUTE)
  expect(forks()).toBe(1)
  await clock.advance(50 * MINUTE)
  expect(forks()).toBe(2)
  // The two-hour window closes before a third ping is due.
  await clock.advance(3 * 60 * MINUTE)
  expect(forks()).toBe(2)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /cache cold/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 pings, 360k read/ })).toBeDefined()
  await ui.unmount()
})

test('off until it is switched on: no ping is sent, asked for or not, and nothing is drawn even once the cache is cold', async ($, on) => {
  const { clock, forks } = world(on, [WARM])
  await $.session.start(START)
  await $.turn.complete(DONE)
  await clock.advance(30 * MINUTE)

  const warm = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await warm.find({ type: 'Text', text: /keepwarm/ })).toBeUndefined()
  await warm.unmount()
  const asked = { command: 'keepwarm', args: 'now', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 170 } } as const
  expect((await $.command.run(asked)).text).toBe('Keep warm is off here; switch it on in the mods panel, or with /mods keepwarm on.')

  await clock.advance(45 * MINUTE)
  expect(forks()).toBe(0)
  const cold = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await cold.find({ type: 'Text', text: /keepwarm/ })).toBeUndefined()
  expect(await cold.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await cold.unmount()
})

test('switched on, it says when the cache has gone cold and what the next turn re-reads', { options: { enabled: true, hours: 1 } }, async ($, on) => {
  const { clock, forks } = world(on, [WARM])
  await $.session.start(START)
  await $.turn.complete(DONE)
  // One ping at 50 minutes; the hour's window is over before another is due, and the cache then lapses.
  await clock.advance(51 * MINUTE)
  await clock.advance(75 * MINUTE)

  expect(forks()).toBe(1)
  const cold = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await cold.find({ type: 'Text', text: /cache cold for \d+m · the next turn re-reads about 180k tokens/ })).toBeDefined()
  await cold.unmount()
})

test('two pings in a row that pay instead of read stop it for good', { options: { enabled: true, hours: 6 } }, async ($, on) => {
  const { clock, forks } = world(on, [REBUILT])
  await $.session.start(START)
  await $.turn.complete(DONE)

  await clock.advance(51 * MINUTE)
  await clock.advance(51 * MINUTE)
  expect(forks()).toBe(2)
  await clock.advance(4 * 60 * MINUTE)
  expect(forks()).toBe(2)
})

test('a new turn takes the countdown over, and a compaction pauses it', { options: { enabled: true, hours: 6 } }, async ($, on) => {
  const { clock, forks } = world(on, [WARM])
  on('session.compact', ($, e) => ({ messages: [...e.messages] }))
  await $.session.start(START)
  await $.turn.complete(DONE)
  await clock.advance(40 * MINUTE)
  await $.turn.start({ text: 'again', turnId: 'turn-2' })
  await clock.advance(20 * MINUTE)
  // The turn is still running at the old ping's time: nothing is sent.
  expect(forks()).toBe(0)
  await $.turn.complete({ ...DONE, turnId: 'turn-2' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  await clock.advance(3 * 60 * MINUTE)
  expect(forks()).toBe(0)
})

test('the cache lifetime comes from the option, then the setting, then the plan', () => {
  expect(pickTtl('5m', '1h', true)).toBe('5m')
  expect(pickTtl('auto', '1h', false)).toBe('1h')
  expect(pickTtl('auto', undefined, true)).toBe('1h')
  expect(pickTtl('auto', undefined, false)).toBe('5m')
})

test('a ping is only planned while the cache is alive and the window is open', () => {
  const watch: KeepwarmWatch = { status: 'armed', reason: '', freshAt: T0, until: T0 + 120 * MINUTE, nextAt: 0, ttl: '1h', pings: 0, misses: 0, readTokens: 0, context: 0, last: null }

  expect(nextPingAt(watch, T0)).toBe(T0 + 50 * MINUTE)
  expect(nextPingAt({ ...watch, until: T0 + 40 * MINUTE }, T0)).toBeNull()
  expect(nextPingAt(watch, T0 + 61 * MINUTE)).toBeNull()
  expect(isCold(watch, T0 + 61 * MINUTE)).toBe(true)
  expect(isWarmRead(43_000, 74)).toBe(true)
  expect(isWarmRead(30_000, 12_000)).toBe(true)
  expect(isWarmRead(0, 43_000)).toBe(false)
  expect(lineOf({ ...watch, nextAt: T0 + 50 * MINUTE }, T0, true, true)?.text).toBe('cache warm, 1h 00m left · next ping in 50m · keeping warm 2h 00m more')
  expect(lineOf(watch, T0, false, true)).toBeNull()
  // Switched off it has nothing to say, cold cache or not.
  expect(lineOf(watch, T0 + 61 * MINUTE, true, true)?.tone).toBe('cold')
  expect(lineOf(watch, T0 + 61 * MINUTE, false, true)).toBeNull()
})
