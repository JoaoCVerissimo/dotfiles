import type { ModsLive, ModsRow, ModsSwitches } from '../../types'

// What a mod adds to your usage. `none` is plain code that never calls a
// model, `few` a small or occasional cost, `tokens` model requests of its own.
export type Usage = {
  level: 'none' | 'few' | 'tokens'
  // the sentence a mod's page shows: what costs, how much, and how to avoid it
  note: string
}

// One row of the Mods tab: a switch the person flips. `plugin` and `field`
// name the userConfig option that holds its always-value (`flow.enabled`).
export type Feature = {
  id: string
  plugin: string
  field: string
  title: string
  blurb: string
  usage: Usage
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
  usage: Usage
}

// The tag a row ends with; short, so a 50-column pane keeps room for the blurb.
export const USAGE_LABEL: Readonly<Record<Usage['level'], string>> = { none: 'no tokens', few: 'few tokens', tokens: 'tokens' }

export const FEATURES: readonly Feature[] = [
  {
    id: 'flow',
    plugin: 'flow',
    field: 'enabled',
    title: 'Flow',
    blurb: 'progress, tasks, agents',
    command: 'flow',
    usage: {
      level: 'few',
      note: 'Claude posts its steps through a small tool: a short tool call when a step starts or ends, plus the tool\'s definition and one sentence in the system prompt. With "Ask Claude for its steps" off, Flow is plain code and uses none.',
    },
  },
  {
    id: 'zen',
    plugin: 'look',
    field: 'zen',
    title: 'Zen',
    blurb: 'hide tool noise',
    usage: { level: 'none', note: 'Plain code: it only changes what the transcript shows.' },
  },
  {
    id: 'skins',
    plugin: 'look',
    field: 'skins',
    title: 'Skins',
    blurb: 'a palette per project',
    command: 'skin',
    usage: { level: 'none', note: 'Plain code: it writes a theme file and one line in the project\'s local settings.' },
  },
  {
    id: 'keepwarm',
    plugin: 'keepwarm',
    field: 'enabled',
    title: 'Keep warm',
    blurb: 'ping the prompt cache',
    command: 'keepwarm',
    usage: {
      level: 'tokens',
      note: 'Each ping is a model request that re-reads the whole conversation at the cached price (about a tenth of normal input) for a one-word reply: one every 50 minutes with a 1-hour cache, every 4 with a 5-minute one, for the hours you set after your last turn.',
    },
  },
  {
    id: 'reflect',
    plugin: 'reflect',
    field: 'enabled',
    title: 'Reflect',
    blurb: 'corrections into rules',
    command: 'reflect',
    usage: {
      level: 'few',
      note: 'One small Haiku call (under a thousand tokens) when a prompt reads like a correction or a preference; none for "remember:" or for any other prompt. With "What to look at" on explicit it never calls a model. A saved rule is then one line in the context of later sessions.',
    },
  },
  {
    id: 'browser',
    plugin: 'browser',
    field: 'enabled',
    title: 'Browser',
    blurb: 'web pages in a pane',
    command: 'browser',
    usage: {
      level: 'none',
      note: 'Plain code: pages load in headless Chrome and become text on this machine. Only what you hand to Claude costs: "→ Claude" attaches the page (up to 20,000 characters, about 5,000 tokens) to your next prompt, and "Let Claude open pages" (off) gives Claude a tool whose pages it reads.',
    },
  },
  {
    id: 'alert',
    plugin: 'mods',
    field: 'alert',
    title: 'Done alert',
    blurb: 'sound when a turn ends',
    usage: { level: 'none', note: 'Plain code: a sound from this machine, and the terminal\'s own notification or bell.' },
  },
]

export const EXTERNAL: readonly External[] = [
  {
    id: 'next-steps',
    plugin: 'next-steps@claude-community',
    title: 'Next steps',
    blurb: 'suggested prompts',
    usage: {
      level: 'tokens',
      note: 'One extra model request after each turn that ends in an answer of 80 characters or more: it re-reads the conversation at the cached price and writes up to three short suggestions.',
    },
  },
  {
    id: 'blast-radius',
    plugin: 'blast-radius@claude-code-playground-mods',
    title: 'Blast radius',
    blurb: 'hold risky commands',
    usage: { level: 'none', note: 'Plain code: it matches the command against patterns and looks things up with git and the shell on this machine.' },
  },
  {
    id: 'you-should-know',
    plugin: 'cc-plugin-you-should-know@builtin',
    title: 'You should know',
    blurb: 'what you might miss',
    usage: {
      level: 'tokens',
      note: 'Runs a side agent, so model requests of its own, while Claude works on longer tasks. It is built into Claude Code, and Anthropic does not say how much it uses.',
    },
  },
]

export const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max', 'auto']

// Which of /model's options the session is on. The engine's row holds the
// pick as it was made (`sonnet`, `opus[1m]`), its own words for the default,
// or the full id that settings or --model named, which is matched by family.
export function pickedModel(row: ModsRow | undefined): string {
  if (row === undefined) {
    return ''
  }
  const value = String(row.value)
  if (row.options.includes(value)) {
    return value
  }
  if (/^default\b/i.test(value)) {
    return row.options.includes('default') ? 'default' : ''
  }
  const words = value.toLowerCase().replace(/\[.*$/, '').split('-')
  const family = row.options.find(option => words.includes(option))
  const wide = `${family}[1m]`

  return family === undefined ? '' : /\[1m\]$/i.test(value) && row.options.includes(wide) ? wide : family
}

// The effort settings keep for a model, which a session starts at: auto
// (the model's own default) where they keep none.
export function savedEffort(settings: Readonly<Record<string, unknown>>, model: string): string {
  const all = settings.modelSettings
  const mine = typeof all === 'object' && all !== null ? (all as Record<string, unknown>)[model.replace(/\[.*$/, '')] : undefined
  const level = typeof mine === 'object' && mine !== null ? (mine as { effortLevel?: unknown }).effortLevel : undefined

  return typeof level === 'string' && EFFORTS.includes(level) ? level : 'auto'
}

// The level an /effort run set: the one its answer names (the engine may set
// a lower one than was asked), else the word after the command. Typed, it
// answers nothing a hook is shown, and its slider takes no word either.
export function effortNamed(args: string, answer: string): string {
  const said = /effort level (?:set )?to (\w+)/i.exec(answer)?.[1]?.toLowerCase() ?? ''
  if (EFFORTS.includes(said)) {
    return said
  }
  const typed = args.trim().toLowerCase()

  return EFFORTS.includes(typed) ? typed : ''
}

// What the Control tab holds once a turn has run at `level`. A picked level
// gives way to it: the engine lowers one the model cannot run, and its slider
// can set one for the session without a hook seeing which. Auto stays picked,
// with the level it came to beside it.
export function afterTurn(live: ModsLive, level: string): ModsLive {
  const effort = live.effort === 'auto' ? 'auto' : level

  return live.effort === effort && live.ran === level ? live : { ...live, effort, ran: level }
}

// The effort as the Control tab words it: what the session is set to, and
// what the last turn ran at where that is something else.
export function effortLine(live: ModsLive): string {
  return live.ran === '' || live.ran === live.effort ? live.effort : `${live.effort} · last turn ran at ${live.ran}`
}

// What a new session starts at. Claude Code saves an effort picked with
// /effort as that default, all but max, so the two can part ways unnoticed.
export function savedLine(live: ModsLive): string {
  return `new sessions on this model start at ${live.saved === 'auto' ? 'its own default' : live.saved}`
}

export function savedModelLine(live: ModsLive): string {
  return `new sessions start on ${live.savedModel === 'default' ? 'the default model' : live.savedModel === '' ? 'another model' : live.savedModel}`
}

// What a pick in the Control tab would also change for new sessions, as the
// question put before it is run: Claude Code saves a model picked with /model,
// and an effort picked with /effort (all but max), as the default, and offers
// a mod no way to change the session alone. '' when the pick changes none.
export function alsoSaves(kind: 'model' | 'effort', option: string, live: ModsLive): string {
  if (kind === 'model') {
    return option === live.savedModel
      ? ''
      : `${option} would also become the model new sessions start on: Claude Code saves a model picked this way. Click ${option} again to go ahead.`
  }
  if (option === 'max' || option === live.saved) {
    return ''
  }
  const now = live.saved === 'auto' ? 'none is saved now' : `now ${live.saved}`

  return option === 'auto'
    ? `auto would also clear the effort new sessions on this model start at (${now}). Click auto again to go ahead.`
    : `${option} would also become the effort new sessions on this model start at (${now}): Claude Code saves every level but max. Click ${option} again to go ahead.`
}

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
