// Keep warm: the prompt cache, kept alive while you are away.
//
// A session's cached context expires after a stretch with no request (an hour
// for a subscription's main conversation, five minutes otherwise), and the
// next turn then re-reads everything at full price. After each turn this mod
// schedules one small request shortly before that moment: a fork of the
// session's own last request, which the API serves from the cache and so
// renews it. It goes on for a set number of hours, checks every ping's token
// counts, and stops for good the first time a ping finds the cache gone.
//
// A ping is not free: it reads the whole context at the cache-read rate. The
// band above the prompt says what was spent, and when the cache went cold.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { KeepwarmWatch } from '../types'
import { isCold, isWarmRead, lineOf, nextPingAt, pickTtl, span, tokens, ttlMs } from './lib/plan'

const PING = 'Reply with the single word: ok'
const HOUR = 3_600_000
const OFF = 'Keep warm is off here; switch it on in the mods panel, or with /mods keepwarm on.'
const IDLE: KeepwarmWatch = {
  status: 'idle',
  reason: '',
  freshAt: 0,
  until: 0,
  nextAt: 0,
  ttl: '5m',
  pings: 0,
  misses: 0,
  readTokens: 0,
  context: 0,
  last: null,
}

const watch = atom({ plugin: 'keepwarm', key: 'watch' } as const, IDLE)
// The mods panel's switches for this session; absent when the panel is not loaded.
const switches = { plugin: 'mods', key: 'switches' } as const

let timer: Timer | null = null
// Whether this session draws where the countdown shows and can be stopped: a terminal or the desktop app.
let canDraw = false
let isWorking = false
let ttlSetting: unknown

async function isOn($: EngineInterface, options: PluginOptions): Promise<boolean> {
  return canDraw && ((await read($, switches).catch(() => undefined))?.keepwarm ?? options.enabled === true)
}

function hoursOf(options: PluginOptions): number {
  return typeof options.hours === 'number' && options.hours > 0 ? Math.min(options.hours, 24) : 2
}

async function halt($: EngineInterface, reason: string): Promise<void> {
  timer?.cancel()
  timer = null
  await update($, watch, (old): KeepwarmWatch => ({ ...old, status: 'stopped', nextAt: 0, reason }))
}

// Schedules the next ping from the watch as it stands, or stops when none should go.
async function arm($: EngineInterface, options: PluginOptions): Promise<void> {
  timer?.cancel()
  timer = null
  const now = await $.clock.now()
  const current = await read($, watch)
  if (current.status !== 'armed') {
    return
  }
  const at = nextPingAt(current, now)
  if (at === null) {
    await halt($, isCold(current, now) ? 'stopped: the cache had already expired' : 'the keep-warm window ended')

    return
  }
  await update($, watch, (old): KeepwarmWatch => ({ ...old, nextAt: at }))
  timer = $.clock.after(at - now, () => {
    void ping($, options, false).catch(() => undefined)
  })
}

// One ping. A timer may fire late (a sleeping machine), so everything is checked again first.
async function ping($: EngineInterface, options: PluginOptions, isAsked: boolean): Promise<string> {
  timer = null
  const now = await $.clock.now()
  const current = await read($, watch)
  if (isWorking) {
    return 'A turn is running; it keeps the cache warm by itself.'
  }
  if (current.freshAt === 0) {
    return 'Nothing to keep warm yet: the session has made no request.'
  }
  if (!isAsked && (current.status !== 'armed' || !(await isOn($, options)))) {
    return 'Keep warm is off.'
  }
  if (!isAsked && now >= current.until) {
    await halt($, 'the keep-warm window ended')

    return 'The keep-warm window ended.'
  }
  if (isCold(current, now)) {
    await halt($, 'stopped: the cache had already expired')

    return `The cache expired ${span(now - current.freshAt - ttlMs(current.ttl))} ago; a ping now would pay for the whole context, so none was sent.`
  }
  const reply = await $.model.fork({ prompt: PING }).catch(() => null)
  const at = await $.clock.now()
  if (reply === null || !('usage' in reply)) {
    await halt($, 'stopped: the ping could not be sent')

    return 'The ping could not be sent.'
  }
  const readTokens = reply.usage.cache_read_input_tokens
  const paid = reply.usage.cache_creation_input_tokens + reply.usage.input_tokens
  const isWarm = isWarmRead(readTokens, paid)
  const last = { at, read: readTokens, wrote: paid, isWarm }
  const counts = `read ${tokens(readTokens)} tokens from the cache and paid for ${tokens(paid)}`
  // A ping that mostly paid re-wrote the cache, so it is warm again; two in a row and pings are not reaching it.
  if (!isWarm && current.misses >= 1) {
    await update($, watch, (old): KeepwarmWatch => ({ ...old, freshAt: at, last }))
    await halt($, `stopped: two pings in a row paid for the context instead of reading it (last ${counts})`)

    return `The ping ${counts}. That is the second in a row to pay instead of read, so keep warm stopped.`
  }
  await update($, watch, (old): KeepwarmWatch => ({
    ...old,
    freshAt: at,
    pings: old.pings + 1,
    misses: isWarm ? 0 : old.misses + 1,
    readTokens: old.readTokens + readTokens,
    last,
  }))
  if (!isWorking) {
    await arm($, options)
  }

  return isWarm
    ? `The ping ${counts}: warm for another ${span(ttlMs(current.ttl))}.`
    : `The ping ${counts}: part of the cache had lapsed and was written again. It is warm for another ${span(ttlMs(current.ttl))}.`
}

async function status($: EngineInterface, options: PluginOptions): Promise<string> {
  const now = await $.clock.now()
  const current = await read($, watch)
  const isEnabled = await isOn($, options)
  const line = lineOf(current, now, true, true)
  const head = isEnabled ? `Keep warm is on here (cache lifetime ${current.ttl}, ${hoursOf(options)}h window).` : OFF

  return line === null ? `${head} Nothing to report until the first turn ends.` : `${head} ${line.text}.`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    canDraw = e.surface === 'terminal' || e.surface === 'desktop'
    ttlSetting = (await $.settings.read().catch(() => ({}) as Record<string, unknown>)).promptCacheTtl
    // A reload drops the timer; the watch survives it, so pick the countdown up again.
    await arm($, options)
    // The line counts down in minutes; switched off there is no line to redraw.
    $.clock.every(60_000, () => {
      void isOn($, options).then(
        isEnabled => (isEnabled ? $.ui.invalidate('ui.render') : undefined),
        () => undefined,
      )
    })
    await $.command
      .register({
        name: 'keepwarm',
        description: 'Keep warm: how the prompt cache stands, or ping it now',
        argumentHint: '[status|now]',
        immediate: true,
      })
      .catch(error => $.ui.log(String(error), { to: 'debug' }))

    return next(e)
  })

  // /clear, /resume and /branch start another conversation: the old countdown is not its own.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    timer?.cancel()
    timer = null
    isWorking = false

    return next(e)
  })

  // The panel switched something for this session: start or drop the countdown at once.
  on('state.set', { plugin: 'mods', key: 'switches' }, async ($, e, next) => {
    const result = await next(e)
    void (async () => {
      const isEnabled = await isOn($, options)
      const current = await read($, watch)
      if (isEnabled && current.status !== 'armed' && current.freshAt > 0 && !isWorking) {
        const now = await $.clock.now()
        await update($, watch, (old): KeepwarmWatch => ({ ...old, status: 'armed', reason: '', until: now + hoursOf(options) * HOUR }))
        await arm($, options)
      } else if (!isEnabled && current.status === 'armed') {
        timer?.cancel()
        timer = null
        await update($, watch, (old): KeepwarmWatch => ({ ...old, status: 'idle', nextAt: 0, reason: '' }))
      }
    })().catch(() => undefined)

    return result
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'now') {
      // A ping is a model request: none goes out while the mod is off, asked for or not.
      return { text: (await isOn($, options)) ? await ping($, options, true) : OFF }
    }
    return { text: await status($, options) }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    timer?.cancel()
    timer = null

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }
    isWorking = false
    const now = await $.clock.now()
    const usage = await $.session.usage().catch(() => null)
    const ttl = pickTtl(options.ttl, ttlSetting, (usage?.rateLimits.length ?? 0) > 0)
    const isEnabled = await isOn($, options)
    await update($, watch, (old): KeepwarmWatch => ({
      ...old,
      status: isEnabled ? 'armed' : 'idle',
      reason: '',
      freshAt: now,
      until: now + hoursOf(options) * HOUR,
      nextAt: 0,
      misses: 0,
      ttl,
      context: usage?.context.tokens ?? old.context,
    }))
    if (isEnabled) {
      await arm($, options)
    }

    return result
  })

  // A compaction rewrites the conversation: what was cached is no longer what the next turn sends.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.skip === undefined) {
      timer?.cancel()
      timer = null
      await update($, watch, (old): KeepwarmWatch =>
        old.status === 'armed' ? { ...old, status: 'paused', nextAt: 0, reason: 'paused after a compaction until your next turn' } : old,
      )
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || e.props.isWorking || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return below
    }
    const current = await read($, watch)
    const line = lineOf(current, await $.clock.now(), await isOn($, options), options.coldNote !== false)
    if (line === null) {
      return below
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const color = line.tone === 'warm' ? 'success' : line.tone === 'cold' ? 'warning' : 'inactive'

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={1} paddingRight={5}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={color}>●</Text> <Text dimColor>{`keepwarm · ${line.text}`}</Text>
            </Text>
          </Box>
          {current.status === 'armed' && (
            <Box flexShrink={0}>
              <Button key="keepwarm:stop" plain dimColor label="stop" onPress={() => void halt($, 'stopped by you until the next turn')} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
