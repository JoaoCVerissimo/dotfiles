import type { KeepwarmWatch } from '../../types'

export type Ttl = '5m' | '1h'

const MINUTE = 60_000

export function ttlMs(ttl: Ttl): number {
  return ttl === '1h' ? 60 * MINUTE : 5 * MINUTE
}

// How long after the cache was last fresh a ping goes out: early enough that
// a slow timer still lands inside the lifetime.
export function periodMs(ttl: Ttl): number {
  return ttl === '1h' ? 50 * MINUTE : 4 * MINUTE
}

// The session's cache lifetime: the option when it names one, else the
// promptCacheTtl setting, else one hour where the plan reports limits (a
// subscription's main conversation) and five minutes anywhere else.
export function pickTtl(option: unknown, setting: unknown, hasPlanLimits: boolean): Ttl {
  if (option === '1h' || option === '5m') {
    return option
  }
  if (setting === '1h' || setting === '5m') {
    return setting
  }

  return hasPlanLimits ? '1h' : '5m'
}

export function isCold(watch: KeepwarmWatch, now: number): boolean {
  return watch.freshAt > 0 && now - watch.freshAt >= ttlMs(watch.ttl)
}

// When the next ping is due, or null when none should go: past the window,
// or with the cache already gone (a ping then would pay for the whole context).
export function nextPingAt(watch: KeepwarmWatch, now: number): number | null {
  if (watch.status !== 'armed' || watch.freshAt === 0 || isCold(watch, now)) {
    return null
  }
  const due = watch.freshAt + periodMs(watch.ttl)

  return due >= watch.until ? null : Math.max(due, now + 1000)
}

// A ping found the cache when most of what it sent was read from it. One
// that mostly paid has still left the cache warm behind it, at a price.
export function isWarmRead(read: number, paid: number): boolean {
  return read > 0 && read >= paid
}

export function span(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  if (minutes < 60) {
    return `${minutes}m`
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function tokens(count: number): string {
  if (count < 1000) {
    return String(count)
  }

  return count < 1_000_000 ? `${Math.round(count / 1000)}k` : `${(count / 1_000_000).toFixed(1)}M`
}

export type Line = { tone: 'warm' | 'cold' | 'note'; text: string }

// The band's line for the watch as it stands now, or null with nothing to say.
export function lineOf(watch: KeepwarmWatch, now: number, isOn: boolean, hasColdNote: boolean): Line | null {
  // Switched off, the mod draws nothing: not even that the cache went cold.
  if (!isOn || watch.freshAt === 0) {
    return null
  }
  const spent = watch.pings === 0 ? '' : ` · ${watch.pings} ping${watch.pings === 1 ? '' : 's'}, ${tokens(watch.readTokens)} read`
  if (isCold(watch, now)) {
    if (!hasColdNote) {
      return null
    }
    const size = watch.context > 0 ? `about ${tokens(watch.context)} tokens` : 'the whole context'

    return { tone: 'cold', text: `cache cold for ${span(now - watch.freshAt - ttlMs(watch.ttl))} · the next turn re-reads ${size} at full price${spent}` }
  }
  const left = span(watch.freshAt + ttlMs(watch.ttl) - now)
  if (watch.status === 'armed' && watch.nextAt > 0) {
    return { tone: 'warm', text: `cache warm, ${left} left · next ping in ${span(watch.nextAt - now)} · keeping warm ${span(watch.until - now)} more${spent}` }
  }
  if (watch.status === 'stopped' || watch.status === 'paused') {
    return { tone: 'note', text: `cache warm, ${left} left · ${watch.reason}${spent}` }
  }

  return null
}
