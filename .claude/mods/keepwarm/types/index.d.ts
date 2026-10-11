// What Keep warm knows about the session's prompt cache.

export type KeepwarmPing = { at: number; read: number; wrote: number; isWarm: boolean }

export type KeepwarmWatch = {
  // armed: a ping is due; paused: waiting for the next turn; stopped: gave up, `reason` says why
  status: 'idle' | 'armed' | 'paused' | 'stopped'
  reason: string
  // when the cache was last known fresh: the last main request, or a warm ping
  freshAt: number
  // pings go on until this time
  until: number
  nextAt: number
  ttl: '5m' | '1h'
  pings: number
  // pings in a row that mostly paid for the context instead of reading it
  misses: number
  readTokens: number
  context: number
  last: KeepwarmPing | null
}

declare module 'claude-code' {
  interface PluginState {
    keepwarm: {
      watch: KeepwarmWatch
    }
  }
}
