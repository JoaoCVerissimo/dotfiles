import type { ModsRow, ModsSwitches } from '../../types'

// One row of the Mods tab: a switch the person flips. `plugin` and `field`
// name the userConfig option that holds its always-value (`flow.enabled`).
export type Feature = {
  id: string
  plugin: string
  field: string
  title: string
  blurb: string
  // the mod's own command, which opens its pane or prints its status
  command?: string
}

// A plugin installed as it ships (Anthropic's): switched on and off whole,
// for every session, through its plugin id.
export type External = {
  id: string
  plugin: string
  title: string
  blurb: string
}

export const FEATURES: readonly Feature[] = [
  { id: 'flow', plugin: 'flow', field: 'enabled', title: 'Flow', blurb: 'progress bar, task checklist, agents, files', command: 'flow' },
  { id: 'zen', plugin: 'look', field: 'zen', title: 'Zen', blurb: 'hide tool noise while Claude works' },
  { id: 'skins', plugin: 'look', field: 'skins', title: 'Skins', blurb: 'a color palette per project', command: 'skin' },
  { id: 'keepwarm', plugin: 'keepwarm', field: 'enabled', title: 'Keep warm', blurb: 'ping the prompt cache while you are away', command: 'keepwarm' },
  { id: 'reflect', plugin: 'reflect', field: 'enabled', title: 'Reflect', blurb: 'turn your corrections into saved rules', command: 'reflect' },
  { id: 'browser', plugin: 'browser', field: 'enabled', title: 'Browser', blurb: 'read a web page in a pane', command: 'browser' },
  { id: 'alert', plugin: 'mods', field: 'alert', title: 'Done alert', blurb: 'sound or notification when a turn ends' },
]

export const EXTERNAL: readonly External[] = [
  { id: 'next-steps', plugin: 'next-steps@claude-community', title: 'Next steps', blurb: 'suggested next prompts after each turn' },
  { id: 'blast-radius', plugin: 'blast-radius@claude-code-playground-mods', title: 'Blast radius', blurb: 'hold risky shell commands until you decide' },
  { id: 'you-should-know', plugin: 'cc-plugin-you-should-know@builtin', title: 'You should know', blurb: 'notes on things you might miss' },
]

export const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max', 'auto']

export const HOTKEYS = 'abcdefghijklmnopqrstuvwxyz'

export function rowOf(rows: readonly ModsRow[], key: string): ModsRow | undefined {
  return rows.find(row => row.key === key)
}

// The always-value of a feature: its option's row when its plugin is loaded,
// null when it is not.
export function alwaysOf(feature: Feature, rows: readonly ModsRow[]): boolean | null {
  const row = rowOf(rows, `${feature.plugin}.${feature.field}`)

  return row === undefined ? null : row.value === true
}

export function isOnHere(feature: Feature, switches: ModsSwitches, rows: readonly ModsRow[]): boolean {
  return switches[feature.id] ?? alwaysOf(feature, rows) ?? false
}

// The settings a feature's page lists. A plugin whose one switch is `enabled`
// gives all its other options; one with several switches names each option
// after its feature (`zenErrors`, `alertSound`), and the prefix sorts them.
export function settingsOf(feature: Feature, rows: readonly ModsRow[]): ModsRow[] {
  const switches = new Set(FEATURES.map(one => `${one.plugin}.${one.field}`))
  const prefix = `${feature.plugin}.`
  const isWhole = feature.field === 'enabled'

  return rows.filter(row => {
    if (!row.key.startsWith(prefix) || switches.has(row.key)) {
      return false
    }

    return isWhole || row.key.slice(prefix.length).startsWith(feature.id)
  })
}

export function externalRows(external: External, rows: readonly ModsRow[]): ModsRow[] {
  const prefix = `${external.plugin.split('@')[0] ?? external.plugin}.`

  return rows.filter(row => row.key.startsWith(prefix))
}

export function clip(text: string, max: number): string {
  const points = [...text]

  return points.length <= max ? text : `${points.slice(0, Math.max(0, max - 1)).join('')}…`
}

export function baseName(path: string): string {
  const parts = path.split('/').filter(part => part !== '')

  return parts.at(-1) ?? path
}

export function ago(ms: number): string {
  if (ms < 45_000) {
    return 'now'
  }
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 48) {
    return `${hours}h`
  }

  return `${Math.round(hours / 24)}d`
}

export function took(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)

  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// `/mods <words>` as the command hook reads it.
export type Ask =
  | { kind: 'open'; tab: 'mods' | 'control' | 'sessions' }
  | { kind: 'stop' }
  | { kind: 'close' }
  | { kind: 'switch'; feature: Feature; to: 'on' | 'off' | 'toggle' | 'default'; isAlways: boolean }
  | { kind: 'unknown'; word: string }

export function parseAsk(args: string): Ask {
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const first = words[0]
  if (first === undefined || first === 'mods' || first === 'open') {
    return { kind: 'open', tab: 'mods' }
  }
  if (first === 'control' || first === 'sessions') {
    return { kind: 'open', tab: first }
  }
  if (first === 'stop') {
    return { kind: 'stop' }
  }
  if (first === 'close') {
    return { kind: 'close' }
  }
  const feature = FEATURES.find(one => one.id === first || one.title.toLowerCase().replace(/\s+/g, '') === first)
  if (feature === undefined) {
    return { kind: 'unknown', word: first }
  }
  const second = words[1]
  const to = second === 'on' || second === 'off' || second === 'default' ? second : 'toggle'

  return { kind: 'switch', feature, to, isAlways: words.includes('always') }
}
