import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { FEATURES, afterTurn, alsoSaves, effortLine, effortNamed, parseAsk, pickedModel, savedEffort, settingsOf } from '../hooks/lib/catalog'
import { buildRoster, openingOf, parseTitles, parseTtys, projectFolder } from '../hooks/lib/sessions'

const PANE = {
  plugin: 'mods',
  component: 'Pane',
  requestId: 'mods',
  viewport: { columns: 160, rows: 46 },
  props: { title: 'Mods', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const ROWS = [
  { key: 'model', label: 'Model', kind: 'choice', value: 'Default (recommended)', options: ['default', 'sonnet', 'opus', 'haiku', 'fable', 'opus[1m]', 'fable[1m]', 'opusplan'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
  { key: 'look.zen', label: 'Zen', kind: 'boolean', value: false, provider: { plugin: 'look', tier: 'user' }, isLocked: false },
  { key: 'look.zenErrors', label: 'Zen keeps failures', kind: 'boolean', value: true, provider: { plugin: 'look', tier: 'user' }, isLocked: false },
  { key: 'look.skins', label: 'Skins', kind: 'boolean', value: false, provider: { plugin: 'look', tier: 'user' }, isLocked: false },
  { key: 'mods.alert', label: 'Done alert', kind: 'boolean', value: false, provider: { plugin: 'mods', tier: 'user' }, isLocked: false },
  { key: 'mods.alertSound', label: 'Alert sound', kind: 'choice', value: 'Glass', options: ['none', 'Glass'], provider: { plugin: 'mods', tier: 'user' }, isLocked: false },
] as const

// What the engine holds of a session: the model /model's row says is picked, the id that
// comes to, the effort settings keep for each model, and the model they name for new
// sessions (none: the default). A test moves it as the commands do.
type Session = { picked: string; model: string; saved: Record<string, { effortLevel?: string }>; named?: string }

function session(): Session {
  return { picked: 'Default (recommended)', model: 'claude-opus-5-5', saved: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }
}

// `channel` is the notification channel the terminal offers the engine (Apple's Terminal offers none),
// and `told` collects what the engine was asked to notify.
type World = { ran?: string[][]; printed?: (argv: readonly string[]) => string; held?: Session; channel?: 'iterm2'; told?: string[] }

// Everything the mod asks of Claude Code at a session's start, answered from memory.
function world(on: On, { ran = [], printed = () => '', held = session(), channel, told = [] }: World = {}): MockClock {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/me', TERM_PROGRAM: 'Apple_Terminal' })
  on('session.start', () => ({ cwd: '/work/app' }))
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('config.list', () => ({ value: ROWS.map(row => (row.key === 'model' ? { ...row, value: held.picked } : { ...row })) }))
  on('settings.read', () => ({ value: { enabledPlugins: { 'next-steps@claude-community': true }, modelSettings: held.saved, model: held.named } }))
  on('session.model', () => ({ value: held.model }))
  on('session.id', () => ({ value: 'self-session' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', ($, e) => {
    told.push(e.text)

    return { value: channel === undefined ? { isSent: false, reason: 'no-channel' } : { isSent: true, channel } }
  })
  on('process.run', ($, e) => {
    ran.push([...e.argv])

    return { value: { exitCode: 0, stdout: printed(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return clock
}

// A command as the person's own Enter raises it.
function typed(command: string, args: string) {
  return { command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/app' } as const

test('a click on a mod switches it for this session, and its page shows the always switch and what it uses', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ key: 'here:zen' }))?.text).toContain('○')
  await ui.press({ key: 'here:zen' })
  expect((await ui.find({ key: 'here:zen' }))?.text).toContain('●')
  // Each row ends with what the mod adds to your usage.
  expect((await ui.find({ key: 'more:zen' }))?.text).toContain('no tokens')
  expect((await ui.find({ key: 'more:keepwarm' }))?.text).toMatch(/^\s*tokens ›$/)
  expect((await ui.find({ key: 'more:blast-radius' }))?.text).toContain('no tokens')

  await ui.press({ key: 'more:zen' })
  expect((await ui.find({ key: 'here' }))?.text).toContain('●')
  expect((await ui.find({ key: 'always' }))?.text).toContain('○')
  expect(await ui.find({ type: 'Text', text: 'Plain code: it only changes what the transcript shows.' })).toBeDefined()
  // Zen's page lists Zen's options and none of Skins'.
  expect(await ui.find({ key: 'set:look.zenErrors' })).toBeDefined()
  expect(await ui.find({ key: 'set:look.skins' })).toBeUndefined()
  await ui.unmount()
})

test('the always switch writes the mod\'s own option through /config', async ($, on) => {
  const written: Array<{ key: string; value: unknown }> = []
  world(on)
  on('config.set', ($, e) => {
    written.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'more:zen' })
  await ui.press({ key: 'always' })

  expect(written).toEqual([{ key: 'look.zen', value: true }])
  await ui.unmount()
})

test('/mods switches by name and says what it did', async ($, on) => {
  world(on)
  await $.session.start(START)

  expect((await $.command.run(typed('mods', 'zen on'))).text).toBe('Zen is on for this session.')
  expect((await $.command.run(typed('mods', 'zen'))).text).toBe('Zen is off for this session.')
  expect((await $.command.run(typed('mods', 'nope'))).text).toContain('No mod is called "nope"')
  expect((await $.command.run(typed('mods', 'stop'))).text).toBe('Nothing is running.')
})

test('the control tab runs the model command and stops the running turn', async ($, on) => {
  const commands: string[] = []
  const aborted: string[] = []
  world(on)
  on('command.run', { command: ['model', 'effort'] }, ($, e) => {
    commands.push(`/${e.command} ${e.args}`.trim())

    return {}
  })
  on('turn.abort', ($, e) => {
    aborted.push(e.turnId)

    return { value: undefined }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'do it', turnId: 'turn-1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab:control' })
  // The model new sessions start on runs at the first click.
  await ui.press({ key: 'model:default' })
  await ui.press({ key: 'stop' })

  expect(commands).toEqual(['/model default'])
  expect(aborted).toEqual(['turn-1'])
  // The permission mode is not the panel's to set, so the tab has nothing about it.
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text === 'Mode')).toEqual([])
  expect(await ui.find({ key: 'ask' })).toBeUndefined()
  await ui.unmount()
})

test('the control tab marks the model and the effort the session is on, and a click moves the mark', async ($, on) => {
  const held = session()
  const clock = world(on, { held })
  // The engine's /model as a live session runs it: the pick is also saved for new sessions.
  on('command.run', { command: 'model' }, ($, e) => {
    held.picked = e.args === 'default' ? 'Default (recommended)' : e.args
    held.model = e.args === 'haiku' ? 'claude-haiku-5-5' : 'claude-opus-5-5'
    held.named = e.args === 'default' ? undefined : e.args

    return { text: `Set model to ${e.args} and saved as your default for new sessions` }
  })
  // It saves a level as the default for new sessions, all but max.
  const ran: string[] = []
  on('command.run', { command: 'effort' }, ($, e) => {
    ran.push(`/effort ${e.args}`)
    if (e.args !== 'max') {
      held.saved = { ...held.saved, [held.model]: { effortLevel: e.args } }
    }

    return { text: `Set effort level to ${e.args} (${e.args === 'max' ? 'this session only' : 'saved as your default for new sessions'}): as asked` }
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab:control' })
  const marked = async (group: string) =>
    (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith(`${group}:`) === true && button.text.includes('●')).map(button => button.key)

  // The default model is the engine's own words in its row, and the effort is what settings keep for it.
  expect(await marked('model')).toEqual(['model:default'])
  expect(await marked('effort')).toEqual(['effort:xhigh'])
  expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()

  expect(await ui.find({ type: 'Text', text: 'new sessions on this model start at xhigh' })).toBeDefined()

  expect(await ui.find({ type: 'Text', text: 'new sessions start on the default model' })).toBeDefined()

  // A level would also become the default for new sessions, so the first click only asks.
  await ui.press({ key: 'effort:low' })
  await clock.settle()
  expect(ran).toEqual([])
  expect(await marked('effort')).toEqual(['effort:xhigh'])
  expect(await ui.find({ type: 'Text', text: 'low would also become the effort new sessions on this model start at (now xhigh)' })).toBeDefined()
  // The same click again goes ahead, and the tab shows what new sessions now start at.
  await ui.press({ key: 'effort:low' })
  await clock.settle()
  expect(ran).toEqual(['/effort low'])
  expect(await marked('effort')).toEqual(['effort:low'])
  expect(await ui.find({ type: 'Text', text: 'new sessions on this model start at low' })).toBeDefined()

  // Max stays in the session, so it needs no second click and leaves that default alone.
  await ui.press({ key: 'effort:max' })
  await clock.settle()
  expect(ran).toEqual(['/effort low', '/effort max'])
  expect(await marked('effort')).toEqual(['effort:max'])
  expect(await ui.find({ type: 'Text', text: 'new sessions on this model start at low' })).toBeDefined()

  // A question that was left for another control is not answered by a later click.
  await ui.press({ key: 'effort:high' })
  await clock.settle()
  await ui.press({ key: 'tab:mods' })
  await ui.press({ key: 'tab:control' })
  await ui.press({ key: 'effort:high' })
  await clock.settle()
  expect(ran).toEqual(['/effort low', '/effort max'])
  await ui.press({ key: 'tab:control' })

  // A model is saved the same way; the effort stays through the change, as the engine keeps it.
  await ui.press({ key: 'model:haiku' })
  await clock.settle()
  expect(await marked('model')).toEqual(['model:default'])
  expect(await ui.find({ type: 'Text', text: 'haiku would also become the model new sessions start on' })).toBeDefined()
  await ui.press({ key: 'model:haiku' })
  await clock.settle()
  expect(await marked('model')).toEqual(['model:haiku'])
  expect(await ui.find({ type: 'Text', text: 'new sessions start on haiku' })).toBeDefined()
  expect(await marked('effort')).toEqual(['effort:max'])
  expect(await ui.find({ type: 'Text', text: 'claude-haiku-5-5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'new sessions on this model start at its own default' })).toBeDefined()
  await ui.unmount()
})

test('the effort mark follows /effort typed at the prompt, its slider, and what a turn ran at', async ($, on) => {
  const held = session()
  world(on, { held })
  // Typed, /effort answers nothing a hook is shown; its slider, confirmed, saves the level in settings.
  on('command.run', { command: 'effort' }, ($, e) => {
    if (e.args === '') {
      held.saved = { 'claude-opus-5-5': { effortLevel: 'high' } }
    }

    return {}
  })
  on('classic.Stop', () => ({}))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab:control' })
  const marked = async () =>
    (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('effort:') === true && button.text.includes('●')).map(button => button.key)

  await $.command.run(typed('effort', 'low'))
  expect(await marked()).toEqual(['effort:low'])

  await $.command.run(typed('effort', ''))
  expect(await marked()).toEqual(['effort:high'])

  // A level the model cannot run is lowered by the engine: the turn says what it ran at.
  await $.command.run(typed('effort', 'max'))
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'xhigh' } })
  expect(await marked()).toEqual(['effort:xhigh'])

  // Auto stays picked, with the level it came to beside it.
  await $.command.run(typed('effort', 'auto'))
  await $.turn.start({ text: 'again', turnId: 'turn-2' })
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'high' } })
  expect(await marked()).toEqual(['effort:auto'])
  expect(await ui.find({ type: 'Text', text: 'auto · last turn ran at high' })).toBeDefined()

  // A turn that was running when the effort changed reports the old level, which is not taken.
  await $.turn.start({ text: 'more', turnId: 'turn-3' })
  await $.command.run(typed('effort', 'max'))
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'high' } })
  expect(await marked()).toEqual(['effort:max'])
  await ui.unmount()
})

test('the done alert is off until switched on: a long turn ends in silence, then with a sound once /mods switches it', async ($, on) => {
  const ran: string[][] = []
  const clock = world(on, { ran })
  await $.session.start(START)
  const turn = { answer: 'done', isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await clock.settle()
  expect(alerts(ran)).toEqual([])

  expect((await $.command.run(typed('mods', 'alert on'))).text).toBe('Done alert is on for this session.')
  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await clock.settle()
  expect(ran.some(argv => argv[0] === 'afplay')).toBe(true)
})

// The commands an alert runs: the sound, and the bell written to the session's own terminal.
const alerts = (ran: string[][]) => ran.filter(argv => argv[0] === 'afplay' || argv[0] === 'osascript' || (argv[0] === 'sh' && argv[2]?.includes('printf "\\a"') === true)).map(argv => argv[0])

test('a long turn ends with a sound and the terminal\'s bell, a short one with neither, and no banner is posted', { options: { alert: true } }, async ($, on) => {
  const ran: string[][] = []
  const clock = world(on, { ran })
  await $.session.start(START)
  const turn = { answer: 'done', isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

  await $.turn.complete({ ...turn, durationMs: 3000 })
  await clock.settle()
  expect(alerts(ran)).toEqual([])

  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await clock.settle()
  expect(ran.some(argv => argv[0] === 'afplay' && argv[1] === '/System/Library/Sounds/Glass.aiff')).toBe(true)
  // The bell goes to the terminal this process sits on, found through its own tty.
  expect(ran.some(argv => argv[0] === 'sh' && argv[2]?.includes('ps -o tty= -p "$PPID"') === true)).toBe(true)
  expect([...alerts(ran)].sort()).toEqual(['afplay', 'sh'])
})

test('a terminal with notifications of its own gets one, and no bell on top', { options: { alert: true } }, async ($, on) => {
  const ran: string[][] = []
  const told: string[] = []
  const clock = world(on, { ran, channel: 'iterm2', told })
  await $.session.start(START)

  await $.turn.complete({ answer: 'done', isAborted: false, turnId: 'turn-1', reason: 'answer', durationMs: 60_000 })
  await clock.settle()
  expect(told).toEqual(['Claude is done in app · 1m 0s'])
  expect(alerts(ran)).toEqual(['afplay'])
})

test('the hint line carries the quick buttons, and a stop button while a turn runs', async ($, on) => {
  world(on)
  await $.session.start(START)
  const hint = { plugin: 'mods', component: 'PromptHint', viewport: { columns: 150, rows: 40 } } as const
  const idle = await $.ui.mount({ ...hint, surface: 'terminal', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
  expect(await idle.find({ key: 'chip:mods' })).toBeDefined()
  expect(await idle.find({ key: 'chip:stop' })).toBeUndefined()
  await idle.unmount()

  const busy = await $.ui.mount({ ...hint, surface: 'terminal', props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' } })
  expect(await busy.find({ key: 'chip:stop' })).toBeDefined()
  await busy.unmount()
})

// Three sessions on this machine as `claude agents --json --all` prints them; the middle one is this session.
const AGENTS = [
  { pid: 11, cwd: '/work/api', kind: 'interactive', startedAt: 100, sessionId: 'a', name: 'api-1', status: 'idle' },
  { pid: 12, cwd: '/work/app', kind: 'interactive', startedAt: 200, sessionId: 'self-session', name: 'app-2', status: 'busy' },
  { pid: 13, cwd: '/work/web', kind: 'interactive', startedAt: 300, sessionId: 'c', name: 'web-3', status: 'idle' },
]

function withSessions(on: On): void {
  world(on, { printed: argv => (argv.includes('agents') ? JSON.stringify(AGENTS) : '') })
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }))
}

test('the icon on a session\'s row archives it, and the archived list brings it back', async ($, on) => {
  withSessions(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab:sessions' })

  // Every other session has the icon; this one cannot be archived from itself.
  expect((await ui.find({ key: 'arch:a' }))?.props.label).toBe('⊟')
  expect((await ui.find({ key: 'arch:c' }))?.props.label).toBe('⊟')
  expect(await ui.find({ key: 'arch:self-session' })).toBeUndefined()

  await ui.press({ key: 'arch:a' })
  expect(await ui.find({ key: 'open:a' })).toBeUndefined()
  expect((await ui.find({ key: 'archived' }))?.text).toContain('(1)')
  // One click hid a row, so the panel says so and how to get it back.
  expect(await ui.find({ type: 'Text', text: 'Archived api-1: it is only hidden' })).toBeDefined()

  await ui.press({ key: 'archived' })
  expect((await ui.find({ key: 'arch:a' }))?.props.label).toBe('⊞')
  await ui.press({ key: 'arch:a' })
  expect((await ui.find({ key: 'arch:a' }))?.props.label).toBe('⊟')
  await ui.unmount()
})

test('no control in the panel answers a single key', async ($, on) => {
  withSessions(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The buttons a page draws, and those among them a key would press.
  const page = async () => {
    const buttons = await ui.findAll({ type: 'Button' })

    return { count: buttons.length, keyed: buttons.filter(button => button.props.hotkey !== undefined || button.props.action !== undefined).map(button => button.key) }
  }

  for (const open of [[], ['more:flow'], ['back', 'more:next-steps'], ['tab:control'], ['tab:sessions']]) {
    for (const key of open) {
      await ui.press({ key })
    }
    const drawn = await page()
    expect(drawn.count > 3, `buttons after ${open.join(', ') || 'opening'}`).toBe(true)
    expect(drawn.keyed).toEqual([])
  }
  await ui.unmount()

  const hint = { plugin: 'mods', component: 'PromptHint', viewport: { columns: 150, rows: 40 } } as const
  const chips = await $.ui.mount({ ...hint, surface: 'terminal', props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' } })
  expect((await chips.findAll({ type: 'Button' })).filter(button => button.props.hotkey !== undefined)).toEqual([])
  await chips.unmount()
})

test('words after /mods are read as a tab, a stop or a switch', () => {
  expect(parseAsk('')).toEqual({ kind: 'open', tab: 'mods' })
  expect(parseAsk('sessions')).toEqual({ kind: 'open', tab: 'sessions' })
  expect(parseAsk('stop')).toEqual({ kind: 'stop' })
  const ask = parseAsk('Keepwarm off always')
  expect(ask.kind === 'switch' && ask.feature.id === 'keepwarm' && ask.to === 'off' && ask.isAlways).toBe(true)
})

test('a feature page lists its own options only', () => {
  const rows = ROWS.map(row => ({ key: row.key, label: row.label, description: '', kind: row.kind, value: row.value, options: [] as string[] }))
  const alert = FEATURES.find(feature => feature.id === 'alert')
  const zen = FEATURES.find(feature => feature.id === 'zen')

  expect(alert === undefined ? [] : settingsOf(alert, rows).map(row => row.key)).toEqual(['mods.alertSound'])
  expect(zen === undefined ? [] : settingsOf(zen, rows).map(row => row.key)).toEqual(['look.zenErrors'])
})

test('the model in use is found among /model\'s options, however it was named', () => {
  const row = (value: string) => ({ key: 'model', label: 'Model', description: '', kind: 'choice' as const, value, options: [...(ROWS[0].options)] })

  expect(pickedModel(row('Default (recommended)'))).toBe('default')
  expect(pickedModel(row('opus[1m]'))).toBe('opus[1m]')
  expect(pickedModel(row('opusplan'))).toBe('opusplan')
  // A full id, as settings or --model name one, is matched by family, and by context size where /model lists it.
  expect(pickedModel(row('claude-fable-5-1[1m]'))).toBe('fable[1m]')
  expect(pickedModel(row('claude-opus-5-5'))).toBe('opus')
  expect(pickedModel(row('claude-sonnet-5-5[1m]'))).toBe('sonnet')
  expect(pickedModel(row('some-other-model'))).toBe('')
  expect(pickedModel(undefined)).toBe('')
})

test('the effort is read from settings, from an /effort run and from a turn', () => {
  const settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' }, 'claude-sonnet-5-5': {} } }
  expect(savedEffort(settings, 'claude-opus-5-5[1m]')).toBe('xhigh')
  expect(savedEffort(settings, 'claude-sonnet-5-5')).toBe('auto')
  expect(savedEffort({}, 'claude-haiku-5-5')).toBe('auto')

  expect(effortNamed('max', '')).toBe('max')
  expect(effortNamed('max', 'Set effort level to high (this session only): the most this model runs')).toBe('high')
  expect(effortNamed('', 'Set effort level to high (saved as your default for new sessions): thorough')).toBe('high')
  expect(effortNamed('', 'Effort level set to auto')).toBe('auto')
  expect(effortNamed('', 'Cancelled')).toBe('')
  expect(effortNamed('', '')).toBe('')

  const live = { model: 'claude-opus-5-5', effort: 'max', ran: '', saved: 'xhigh', savedModel: 'default' }
  expect(afterTurn(live, 'max')).toEqual({ ...live, ran: 'max' })
  expect(afterTurn(live, 'high').effort).toBe('high')
  expect(afterTurn({ ...live, effort: 'auto' }, 'high')).toEqual({ ...live, effort: 'auto', ran: 'high' })
  expect(effortLine({ ...live, ran: 'max' })).toBe('max')
  expect(effortLine({ ...live, effort: 'auto', ran: 'high' })).toBe('auto · last turn ran at high')
  expect(effortLine(live)).toBe('max')

  // What a pick would also save: nothing for max, for the level already saved, or for the model new sessions start on.
  expect(alsoSaves('effort', 'max', live)).toBe('')
  expect(alsoSaves('effort', 'xhigh', live)).toBe('')
  expect(alsoSaves('effort', 'high', live)).toContain('high would also become the effort new sessions on this model start at (now xhigh)')
  expect(alsoSaves('effort', 'auto', live)).toContain('auto would also clear the effort new sessions on this model start at (now xhigh)')
  expect(alsoSaves('effort', 'auto', { ...live, saved: 'auto' })).toBe('')
  expect(alsoSaves('model', 'default', live)).toBe('')
  expect(alsoSaves('model', 'sonnet', live)).toContain('sonnet would also become the model new sessions start on')
})

test('the roster lists live sessions first and knows how each one opens', () => {
  const agents = [
    { pid: 11, cwd: '/work/api', kind: 'interactive', startedAt: 100, sessionId: 'a', name: 'api-1', status: 'idle' },
    { pid: 12, cwd: '/work/app', kind: 'interactive', startedAt: 200, sessionId: 'self', name: 'app-2', status: 'busy' },
    { cwd: '/work/app', kind: 'background', startedAt: 50, id: 'job1', sessionId: 'b', name: 'nightly', state: 'done' },
  ]
  const rows = buildRoster({
    agents,
    records: { '11': { updatedAt: 900, entrypoint: 'cli' } },
    ttys: parseTtys('   11 ttys003\n   12 ??\n'),
    past: [{ sessionId: 'old', at: 5000, title: 'Fix the build', cwd: '/work/app' }, { sessionId: 'a', at: 1, title: 'dup', cwd: '/work/api' }],
    selfId: 'self',
  })

  expect(rows.map(row => row.key)).toEqual(['a', 'self', 'old', 'b'])
  expect(openingOf(rows[0]!)).toEqual({ kind: 'terminal', tty: '/dev/ttys003' })
  expect(openingOf(rows[1]!)).toEqual({ kind: 'self' })
  expect(openingOf(rows[2]!)).toEqual({ kind: 'resume', sessionId: 'old' })
  expect(openingOf(rows[3]!)).toEqual({ kind: 'resume', sessionId: 'b' })
})

test('transcript titles and project folders are read the way Claude Code writes them', () => {
  const out = [
    '/c/projects/-work-app/aaa.jsonl:"aiTitle":"First guess"',
    '/c/projects/-work-app/aaa.jsonl:"aiTitle":"Fix the \\"build\\""',
    '/c/projects/-work-app/bbb.jsonl:"aiTitle":"Generated"',
    '/c/projects/-work-app/bbb.jsonl:"customTitle":"Named by me"',
    '/c/projects/-work-app/bbb.jsonl:"aiTitle":"Generated later"',
  ].join('\n')

  expect(parseTitles(out)).toEqual({ aaa: 'Fix the "build"', bbb: 'Named by me' })
  expect(projectFolder('/Users/me/My Project_1')).toBe('-Users-me-My-Project-1')
})
