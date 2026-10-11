import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { parseAsk, settingsOf, FEATURES } from '../hooks/lib/catalog'
import { buildRoster, openingOf, parseTitles, parseTtys, projectFolder } from '../hooks/lib/sessions'

const PANE = {
  plugin: 'mods',
  component: 'Pane',
  requestId: 'mods',
  viewport: { columns: 160, rows: 46 },
  props: { title: 'Mods', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const ROWS = [
  { key: 'model', label: 'Model', kind: 'choice', value: 'opus', options: ['default', 'opus', 'haiku'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
  { key: 'look.zen', label: 'Zen', kind: 'boolean', value: false, provider: { plugin: 'look', tier: 'user' }, isLocked: false },
  { key: 'look.zenErrors', label: 'Zen keeps failures', kind: 'boolean', value: true, provider: { plugin: 'look', tier: 'user' }, isLocked: false },
  { key: 'look.skins', label: 'Skins', kind: 'boolean', value: true, provider: { plugin: 'look', tier: 'user' }, isLocked: false },
  { key: 'mods.alert', label: 'Done alert', kind: 'boolean', value: true, provider: { plugin: 'mods', tier: 'user' }, isLocked: false },
  { key: 'mods.alertSound', label: 'Alert sound', kind: 'choice', value: 'Glass', options: ['none', 'Glass'], provider: { plugin: 'mods', tier: 'user' }, isLocked: false },
] as const

// Everything the mod asks of Claude Code at a session's start, answered from memory.
function world(on: On, ran: string[][] = [], printed: (argv: readonly string[]) => string = () => ''): MockClock {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/me', TERM_PROGRAM: 'Apple_Terminal' })
  on('session.start', () => ({ cwd: '/work/app' }))
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('config.list', () => ({ value: ROWS.map(row => ({ ...row })) }))
  on('settings.read', () => ({ value: { enabledPlugins: { 'next-steps@claude-community': true }, permissions: { defaultMode: 'auto' } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'self-session' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
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

test('a letter switches a mod on for this session, and the page shows its always switch', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ key: 'here:zen' }))?.text).toContain('○')
  await ui.press({ key: 'here:zen' })
  expect((await ui.find({ key: 'here:zen' }))?.text).toContain('●')

  await ui.press({ key: 'more:zen' })
  expect((await ui.find({ key: 'here' }))?.text).toContain('●')
  expect((await ui.find({ key: 'always' }))?.text).toContain('○')
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
  on('command.run', { command: ['model', 'effort', 'plan'] }, ($, e) => {
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
  await ui.press({ key: 'model:haiku' })
  await ui.press({ key: 'stop' })

  expect(commands).toEqual(['/model haiku'])
  expect(aborted).toEqual(['turn-1'])
  await ui.unmount()
})

test('a long turn ends with a sound and a banner, a short one with neither', async ($, on) => {
  const ran: string[][] = []
  const clock = world(on, ran)
  await $.session.start(START)
  const turn = { answer: 'done', isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

  await $.turn.complete({ ...turn, durationMs: 3000 })
  await clock.settle()
  expect(ran.filter(argv => argv[0] === 'afplay' || argv[0] === 'osascript')).toHaveLength(0)

  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await clock.settle()
  expect(ran.some(argv => argv[0] === 'afplay' && argv[1] === '/System/Library/Sounds/Glass.aiff')).toBe(true)
  expect(ran.some(argv => argv[0] === 'osascript' && argv.at(-1)?.includes('Claude is done in app') === true)).toBe(true)
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

test('a row\'s letter archives a session, and the archived list brings it back', async ($, on) => {
  const agents = [
    { pid: 11, cwd: '/work/api', kind: 'interactive', startedAt: 100, sessionId: 'a', name: 'api-1', status: 'idle' },
    { pid: 12, cwd: '/work/app', kind: 'interactive', startedAt: 200, sessionId: 'self-session', name: 'app-2', status: 'busy' },
    { pid: 13, cwd: '/work/web', kind: 'interactive', startedAt: 300, sessionId: 'c', name: 'web-3', status: 'idle' },
  ]
  world(on, [], argv => (argv.includes('agents') ? JSON.stringify(agents) : ''))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab:sessions' })

  // Every other session has a letter; this one cannot be archived from itself.
  const letters = (await ui.findAll({ type: 'Button', text: 'archive' })).filter(button => button.key?.startsWith('arch:')).map(button => button.props.hotkey)
  expect(letters).toEqual(['a', 'b'])
  expect(await ui.find({ key: 'arch:self-session' })).toBeUndefined()

  await ui.press({ key: 'arch:a' })
  expect(await ui.find({ key: 'open:a' })).toBeUndefined()
  expect((await ui.find({ key: 'archived' }))?.text).toContain('(1)')

  await ui.press({ key: 'archived' })
  expect((await ui.find({ key: 'arch:a' }))?.props.label).toBe('restore')
  await ui.press({ key: 'arch:a' })
  expect((await ui.find({ key: 'arch:a' }))?.props.label).toBe('archive')
  await ui.unmount()
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
