// The state the mods panel keeps for a session. The other mods read
// `switches` to learn whether they are on here: `switches[id]` when set,
// their own `enabled` option otherwise.

export type ModsTab = 'mods' | 'control' | 'sessions'

export type ModsView = { tab: ModsTab; detail: string | null }

export type ModsSwitches = Record<string, boolean>

export type ModsTurn = { id: string; startedAt: number } | null

export type ModsLive = { mode: string; model: string; effort: string }

export type ModsRow = {
  key: string
  label: string
  description: string
  kind: 'boolean' | 'choice' | 'text' | 'number'
  value: boolean | string | number
  options: string[]
}

export type ModsSessionRow = {
  key: string
  sessionId: string
  pid: number
  name: string
  cwd: string
  kind: string
  status: string
  waitingFor: string
  jobId: string
  tty: string
  entrypoint: string
  at: number
  isLive: boolean
  isSelf: boolean
}

export type ModsRoster = { at: number; rows: ModsSessionRow[]; error: string }

export type ModsPrefs = { archived: string[]; showArchived: boolean; ask: boolean }

declare module 'claude-code' {
  interface PluginState {
    mods: {
      switches: ModsSwitches
      view: ModsView
      turn: ModsTurn
      live: ModsLive
      rows: ModsRow[]
      plugins: Record<string, boolean>
      roster: ModsRoster
      prefs: ModsPrefs
      note: string
    }
  }
}
