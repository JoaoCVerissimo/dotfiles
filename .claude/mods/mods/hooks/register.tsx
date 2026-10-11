// Mods: the panel the other mods are switched from.
//
// Three tabs in one pane. Mods lists every mod with a switch for this session
// (kept in `switches`, which the other mods read) and, on its page, a switch
// for every session and its settings (the engine's own /config rows, so they
// land in settings.json). Control runs the commands one would otherwise type
// (model, effort, stop) and marks what the session is set to. Sessions lists
// the sessions on this machine and opens one. With the done alert on, a turn
// that took a while ends with a sound and a notification.
//
// The panel is the one thing that starts on: every mod it lists starts off,
// and does nothing until its switch is flipped here.

import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, PluginOptions, Register } from 'claude-code'

import type { ModsRow, ModsSessionRow, ModsTab } from '../types'
import type { External, Feature } from './lib/catalog'
import { EXTERNAL, FEATURES, afterTurn, alwaysOf, baseName, effortNamed, isOnHere, parseAsk, savedEffort, took } from './lib/catalog'
import type { PanelActions } from './lib/panel'
import { drawChips, drawPanel } from './lib/panel'
import type { Past } from './lib/sessions'
import { buildRoster, focusScript, openingOf, parseJson, parseTitles, parseTtys, projectFolder } from './lib/sessions'

const PANE = 'mods'
const USAGE = 'Usage: /mods [control|sessions|stop|close] or /mods <mod> [on|off|default] [always]'
const TITLES = '"(customTitle|aiTitle)":"([^"\\\\]|\\\\.)*"'
const PAST_SHOWN = 8

const switches = atom({ plugin: 'mods', key: 'switches' } as const, {})
const view = atom({ plugin: 'mods', key: 'view' } as const, { tab: 'mods', detail: null })
const turn = atom({ plugin: 'mods', key: 'turn' } as const, null)
const live = atom({ plugin: 'mods', key: 'live' } as const, { model: '', effort: '', ran: '' })
const rows = atom({ plugin: 'mods', key: 'rows' } as const, [])
const plugins = atom({ plugin: 'mods', key: 'plugins' } as const, {})
const roster = atom({ plugin: 'mods', key: 'roster' } as const, { at: 0, rows: [], error: '' })
const prefs = atom({ plugin: 'mods', key: 'prefs' } as const, { archived: [], showArchived: false })
const note = atom({ plugin: 'mods', key: 'note' } as const, '')

// Read once at session start; a reload reads them again.
let home = ''
let configDir = ''
let program = ''
let selfId = ''
// Whether a person is at this session's own screen: a terminal or the desktop app.
let canDraw = false
// The effort the session is set to, as far as the panel knows. The engine keeps
// it through /clear, which empties the state above, so it is kept here as well.
let known = ''
// Whether the effort changed since the last turn began: a turn that was
// running at the time may report the level it started at.
let isChanged = false

type Ran = { exitCode: number; stdout: string; stderr: string }

function lite(row: ConfigRow): ModsRow {
  return {
    key: row.key,
    label: row.label,
    description: row.description ?? '',
    kind: row.kind,
    value: typeof row.value === 'object' ? row.value.join(', ') : row.value,
    options: [...(row.options ?? [])],
  }
}

function brief(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, ' ').slice(0, 200)
}

async function say($: EngineInterface, text: string): Promise<void> {
  await update($, note, () => text)
}

async function runClaude($: EngineInterface, args: readonly string[], timeoutMs: number): Promise<Ran> {
  for (const bin of ['claude', `${home}/.local/bin/claude`]) {
    try {
      return await $.process.run([bin, ...args], { timeoutMs })
    } catch {
      continue
    }
  }

  return { exitCode: -1, stdout: '', stderr: 'could not start the claude command' }
}

// The /config rows the panel draws and which of Anthropic's mods are enabled.
async function refresh($: EngineInterface): Promise<void> {
  const wanted = new Set(['mods', ...FEATURES.map(one => one.plugin), ...EXTERNAL.map(one => one.plugin.split('@')[0] ?? '')])
  const all = await $.config.list().catch(() => [])
  const kept = all.filter(row => row.key === 'model' || wanted.has(row.key.split('.')[0] ?? '')).map(lite)
  await update($, rows, () => kept)

  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
  const enabled = settings.enabledPlugins
  const map: Record<string, unknown> = typeof enabled === 'object' && enabled !== null ? { ...enabled } : {}
  const found: Record<string, boolean> = {}
  for (const external of EXTERNAL) {
    if (external.plugin in map || external.plugin.endsWith('@builtin')) {
      found[external.plugin] = map[external.plugin] === true
    }
  }
  await update($, plugins, () => found)

  // The engine tells a mod the session's model and not its effort. A session
  // starts at the level settings keep for its model, /effort changes it, and
  // it stays through /model and /clear: the panel follows the same.
  const model = await $.session.model().catch(() => '')
  const start = known !== '' ? known : savedEffort(settings, model)
  const now = await update($, live, old => ({
    model,
    effort: old.effort !== '' ? old.effort : start,
    // a reload hands back what the panel kept before it, which may lack a field
    ran: old.model === model ? (old.ran ?? '') : '',
  }))
  known = now.effort
}

// The session was set to an effort.
async function setEffort($: EngineInterface, level: string): Promise<void> {
  known = level
  isChanged = true
  await update($, live, old => ({ ...old, effort: level, ran: '' }))
}

async function prime($: EngineInterface): Promise<void> {
  selfId = await $.session.id().catch(() => '')
  const saved = await $.store.get('archived').catch(() => undefined)
  const archived = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
  await update($, prefs, old => ({ ...old, archived }))
  await refresh($)
}

async function loadRoster($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const ran = await runClaude($, ['agents', '--json', '--all'], 20_000)
  const agents = ran.exitCode === 0 ? parseJson(ran.stdout) : undefined
  if (!Array.isArray(agents)) {
    const reason = (ran.stderr || ran.stdout).trim().slice(0, 160) || 'no answer'
    await update($, roster, old => ({ ...old, at: now, error: `Could not list sessions: ${reason}` }))

    return
  }
  const pids = agents
    .map(entry => (typeof entry === 'object' && entry !== null ? (entry as { pid?: unknown }).pid : undefined))
    .filter((pid): pid is number => typeof pid === 'number' && pid > 0)
  const records: Record<string, unknown> = {}
  for (const pid of pids) {
    const raw = await $.fs.read(`${configDir}/sessions/${pid}.json`).catch(() => '')
    records[String(pid)] = raw === '' ? undefined : parseJson(raw)
  }
  const ps = pids.length === 0 ? null : await $.process.run(['ps', '-o', 'pid=,tty=', '-p', pids.join(',')], { timeoutMs: 5000 }).catch(() => null)

  // The saved conversations of this project, newest first, named by their titles.
  const cwd = await $.session.cwd().catch(() => '')
  const folder = `${configDir}/projects/${projectFolder(cwd)}`
  const entries = await $.fs.list(folder).catch(() => [])
  const files = entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, PAST_SHOWN)
  const grep =
    files.length === 0
      ? null
      : await $.process
          .run(['grep', '-H', '-o', '-E', TITLES, ...files.map(file => `${folder}/${file.name}`)], { timeoutMs: 8000 })
          .catch(() => null)
  const titles = grep === null ? {} : parseTitles(grep.stdout)
  const past: Past[] = files.map(file => {
    const sessionId = file.name.slice(0, -'.jsonl'.length)

    return { sessionId, at: file.mtimeMs, title: titles[sessionId] ?? '', cwd }
  })

  const built = buildRoster({ agents, records, ttys: ps === null ? {} : parseTtys(ps.stdout), past, selfId })
  await update($, roster, () => ({ at: now, rows: built, error: '' }))
}

async function openPanel($: EngineInterface, tab: ModsTab): Promise<void> {
  const mine = (await $.ui.panes()).find(pane => pane.id === PANE)
  const current = await read($, view)
  if (mine !== undefined && mine.isShown && current.tab === tab && current.detail === null) {
    await $.ui.close({ id: PANE })

    return
  }
  await update($, view, () => ({ tab, detail: null }))
  await say($, '')
  await $.ui.open({ id: PANE, title: 'Mods', focus: true, columns: 50, rows: 18 })
  await refresh($)
  if (tab === 'sessions') {
    await loadRoster($)
  }
}

async function showTab($: EngineInterface, tab: ModsTab): Promise<void> {
  await update($, view, () => ({ tab, detail: null }))
  await say($, '')
  if (tab === 'sessions') {
    await loadRoster($)
  }
  if (tab === 'control') {
    await refresh($)
  }
}

async function switchHere($: EngineInterface, feature: Feature, to: 'on' | 'off' | 'toggle' | 'default'): Promise<string> {
  const list = await read($, rows)
  if (to === 'default') {
    await update($, switches, old => Object.fromEntries(Object.entries(old).filter(([id]) => id !== feature.id)))

    return `${feature.title} follows its always switch again.`
  }
  const isOn = to === 'toggle' ? !isOnHere(feature, await read($, switches), list) : to === 'on'
  await update($, switches, old => ({ ...old, [feature.id]: isOn }))

  return `${feature.title} is ${isOn ? 'on' : 'off'} for this session.`
}

async function setRow($: EngineInterface, key: string, value: boolean | string | number): Promise<string> {
  await update($, rows, list => list.map(row => (row.key === key ? { ...row, value } : row)))
  try {
    const result = await $.config.set({ key, value })
    if (result.deny !== undefined) {
      await refresh($)

      return result.deny
    }
  } catch (error) {
    await refresh($)

    return brief(error)
  }

  return ''
}

async function switchAlways($: EngineInterface, feature: Feature, to: 'on' | 'off' | 'toggle'): Promise<string> {
  const always = alwaysOf(feature, await read($, rows))
  if (always === null) {
    return `${feature.title}: the ${feature.plugin} mod is not loaded, so there is nothing to switch.`
  }
  const isOn = to === 'toggle' ? !always : to === 'on'
  const refusal = await setRow($, `${feature.plugin}.${feature.field}`, isOn)

  return refusal === '' ? `${feature.title} is ${isOn ? 'on' : 'off'} in every session.` : refusal
}

async function switchExternal($: EngineInterface, external: External): Promise<void> {
  const map = await read($, plugins)
  if (!(external.plugin in map)) {
    await say($, `${external.title} is not installed. Install it with: claude plugin install ${external.plugin}`)

    return
  }
  const isOn = map[external.plugin] === true
  await say($, `${isOn ? 'Disabling' : 'Enabling'} ${external.title}…`)
  const ran = await runClaude($, ['plugin', isOn ? 'disable' : 'enable', external.plugin], 60_000)
  if (ran.exitCode !== 0) {
    await say($, `Could not switch ${external.title}: ${(ran.stderr || ran.stdout).trim().slice(0, 160)}`)

    return
  }
  await update($, plugins, old => ({ ...old, [external.plugin]: !isOn }))
  await say($, `${external.title} is ${isOn ? 'off' : 'on'} in every session; reloading plugins.`)
  // The session reads settings.json a moment after the command wrote it: reload once it has, or the reload misses the change.
  for (let tries = 0; tries < 16; tries += 1) {
    const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
    const enabled = settings.enabledPlugins
    const seen = typeof enabled === 'object' && enabled !== null ? (enabled as Record<string, unknown>)[external.plugin] === true : false
    if (seen === !isOn) {
      break
    }
    await $.clock.sleep(250).catch(() => undefined)
  }
  void $.command.run({ command: 'reload-plugins' }).catch(() => undefined)
}

// A command run from the panel does not pass this mod's own command hooks, so
// what it changed is taken from the run itself.
function runCommand($: EngineInterface, command: string, args: string): void {
  void say($, '')
  void $.command
    .run({ command, args })
    .then(async result => {
      const level = command === 'effort' ? effortNamed(args, result.text ?? '') : ''
      if (level !== '') {
        await setEffort($, level)
      }
      await refresh($)
    })
    .catch(error => say($, `/${command}: ${brief(error)}`))
}

async function stopTurn($: EngineInterface): Promise<string> {
  const current = await read($, turn)
  if (current === null) {
    return 'Nothing is running.'
  }
  try {
    await $.turn.abort({ turnId: current.id })

    return 'Stopped the turn.'
  } catch (error) {
    return `Could not stop the turn: ${brief(error)}`
  }
}

async function openSession($: EngineInterface, row: ModsSessionRow): Promise<void> {
  const how = openingOf(row)
  if (how.kind === 'self') {
    await say($, 'You are in this session.')

    return
  }
  if (how.kind === 'elsewhere') {
    await say($, `${row.name} is open in ${how.where}; switch to it there.`)

    return
  }
  if (how.kind === 'terminal') {
    const script = focusScript(program)
    if (script === null) {
      await say($, `${row.name} is in another terminal tab (${how.tty}).`)

      return
    }
    const ran = await $.process
      .run(['osascript', ...script.flatMap(line => ['-e', line]), how.tty], { timeoutMs: 10_000 })
      .catch(() => null)
    const isFound = ran !== null && ran.exitCode === 0 && ran.stdout.trim() === 'ok'
    await say($, isFound ? '' : `Could not bring the tab of ${row.name} (${how.tty}) to the front.`)

    return
  }
  await say($, `Resuming ${row.name}…`)
  runCommand($, 'resume', how.sessionId)
}

async function toggleArchived($: EngineInterface, row: ModsSessionRow): Promise<void> {
  // Read what the store holds now: another session may have archived since.
  const saved = await $.store.get('archived').catch(() => undefined)
  const held = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
  const isRestore = held.includes(row.key)
  const archived = isRestore ? held.filter(id => id !== row.key) : [...held, row.key].slice(-500)
  await $.store.set('archived', archived).catch(() => undefined)
  await update($, prefs, old => ({ ...old, archived }))
  // An archive is one click, so say what it did and how it is undone.
  await say($, isRestore ? `${row.name} is back in the list.` : `Archived ${row.name}: it is only hidden. Click "archived" to see it again.`)
}

function actionsOf($: EngineInterface): PanelActions {
  return {
    tab: tab => void showTab($, tab),
    detail: id => void update($, view, old => ({ ...old, detail: id })).then(() => say($, '')),
    here: feature => void switchHere($, feature, 'toggle').then(() => say($, '')),
    follow: feature => void switchHere($, feature, 'default').then(() => say($, '')),
    always: feature => void switchAlways($, feature, 'toggle').then(text => say($, text.endsWith('session.') ? '' : text)),
    external: external => void switchExternal($, external),
    setRow: (row, value) => {
      const typed = row.kind === 'number' ? Number(value) : value
      if (typeof typed === 'number' && !Number.isFinite(typed)) {
        void say($, `${row.label} takes a number.`)

        return
      }
      void setRow($, row.key, typed).then(refusal => say($, refusal))
    },
    run: (command, args) => runCommand($, command, args ?? ''),
    stop: () => void stopTurn($).then(text => say($, text)),
    openSession: row => void openSession($, row),
    archive: row => void toggleArchived($, row),
    refreshSessions: () => void loadRoster($),
    showArchived: () => void update($, prefs, old => ({ ...old, showArchived: !old.showArchived })),
  }
}

// A turn that took a while ended: a sound, and a banner saying where.
async function alertDone($: EngineInterface, options: PluginOptions, durationMs: number, isAnswer: boolean): Promise<void> {
  const isOn = (await read($, switches)).alert ?? options.alert === true
  const after = typeof options.alertAfterSeconds === 'number' ? options.alertAfterSeconds : 20
  if (!isOn || durationMs < after * 1000) {
    return
  }
  const sound = typeof options.alertSound === 'string' ? options.alertSound : 'Glass'
  if (sound !== 'none' && /^[A-Za-z]+$/.test(sound)) {
    void $.process.run(['afplay', `/System/Library/Sounds/${sound}.aiff`], { timeoutMs: 10_000 }).catch(() => undefined)
  }
  if (options.alertNotify === false) {
    return
  }
  const where = baseName(await $.session.cwd().catch(() => '')) || 'this session'
  const text = `${isAnswer ? 'Claude is done' : 'The turn ended'} in ${where} · ${took(durationMs)}`
  const banner = ['on run argv', 'display notification (item 1 of argv) with title "Claude Code"', 'end run']
  const shown = await $.process
    .run(['osascript', ...banner.flatMap(line => ['-e', line]), text], { timeoutMs: 10_000 })
    .catch(() => null)
  if (shown === null || shown.exitCode !== 0) {
    await $.ui.notify(text, { title: 'Claude Code' }).catch(() => undefined)
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    canDraw = e.surface === 'terminal' || e.surface === 'desktop'
    home = (await $.env.get('HOME')) ?? ''
    configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    program = (await $.env.get('TERM_PROGRAM')) ?? ''
    await prime($)
    // The session list stays current only while it is the tab in view.
    $.clock.every(15_000, () => {
      void (async () => {
        const mine = (await $.ui.panes()).find(pane => pane.id === PANE)
        if (mine !== undefined && mine.isShown && (await read($, view)).tab === 'sessions') {
          await loadRoster($)
        }
      })().catch(() => undefined)
    })
    await $.command
      .register({
        name: 'mods',
        description: 'Open the mods panel: switch mods on and off, control center, sessions',
        argumentHint: '[control|sessions|stop|<mod> on|off]',
        immediate: true,
      })
      .catch(error => $.ui.log(brief(error), { to: 'debug' }))

    return next(e)
  })

  // /clear, /resume and /branch reset the state above and raise no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await prime($)

    return next(e)
  })

  on('command.run', { command: 'mods' }, async ($, e) => {
    const ask = parseAsk(e.args)
    if (ask.kind === 'open') {
      await openPanel($, ask.tab)

      return {}
    }
    if (ask.kind === 'close') {
      await $.ui.close({ id: PANE })

      return {}
    }
    if (ask.kind === 'stop') {
      return { text: await stopTurn($) }
    }
    if (ask.kind === 'unknown') {
      return { text: `No mod is called "${ask.word}". ${USAGE}` }
    }
    if (!ask.isAlways) {
      return { text: await switchHere($, ask.feature, ask.to) }
    }
    if (ask.to === 'default') {
      return { text: USAGE }
    }

    return { text: await switchAlways($, ask.feature, ask.to) }
  })

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    isChanged = false
    await update($, turn, () => ({ id: e.turnId, startedAt }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await update($, turn, () => null)
      if (!e.isAborted && canDraw) {
        void alertDone($, options, e.durationMs, e.reason === 'answer').catch(() => undefined)
      }
    }

    return result
  })

  // /effort typed at the prompt. The level is the word after it. Its slider
  // takes none and answers nothing a hook is shown, so there the level is
  // read from settings, where a confirmed one is saved; one the slider sets
  // for the session alone shows once a turn has run at it.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const model = await $.session.model().catch(() => '')
    const before = savedEffort(await $.settings.read().catch(() => ({})), model)
    const result = await next(e)
    const named = effortNamed(e.args, result.text ?? '')
    const level = named !== '' ? named : savedEffort(await $.settings.read().catch(() => ({})), model)
    if (named !== '' || level !== before) {
      await setEffort($, level).catch(() => undefined)
    }

    return result
  })

  // /model typed at the prompt, its picker included.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => undefined)

    return result
  })

  // The effort a turn ran at, which is all the engine says of it.
  on('classic.Stop', async ($, e, next) => {
    const level = e.effort?.level ?? ''
    if (level !== '' && !isChanged) {
      known = (await update($, live, old => afterTurn(old, level))).effort
    }

    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (options.chips === false || e.surface !== 'terminal') {
      return next(e)
    }
    const { stop } = actionsOf($)

    return drawChips($.ui.resolve(e), e.props.hint, e.viewport?.columns ?? 80, e.props.isWorking, {
      tab: wanted => void openPanel($, wanted),
      stop,
    })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }

    return drawPanel(
      $.ui.resolve(e),
      {
        width: e.props.bodyColumns,
        view: await read($, view),
        switches: await read($, switches),
        rows: await read($, rows),
        plugins: await read($, plugins),
        live: await read($, live),
        turn: await read($, turn),
        roster: await read($, roster),
        prefs: await read($, prefs),
        note: await read($, note),
        now: await $.clock.now(),
      },
      actionsOf($),
    )
  })
}
