import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { barOf, describe as describeCall, designOf, progressOf, taskCreated, taskUpdated, tasksOfTodos, touched, treeOf, windowOf } from '../hooks/lib/model'

const BAND = {
  plugin: 'flow',
  component: 'AbovePrompt',
  viewport: { columns: 150, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const PANE = {
  plugin: 'flow',
  component: 'Pane',
  requestId: 'flow',
  viewport: { columns: 150, rows: 40 },
  props: { title: 'Flow', isFocused: true, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function world(on: On): void {
  mock.clock(on, { now: 5_000_000 })
  on('session.start', () => ({ cwd: '/work/app' }))
  on('session.root', () => ({ value: '/work/app' }))
  on('command.register', () => ({ value: { command: 'flow' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__flow__steps' } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
  on('tool.call', ($, e) => ({ result: e.tool === 'Write' ? { type: 'create', filePath: '/work/app/src/a.ts' } : 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/app' } as const

test('the band follows a turn: its prompt, the steps Claude posts, the tools it runs', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'Fix the login bug\nand add a test', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Fix the login bug\nand add a test', turnId: 'turn-1' })
  await $.tool.call({
    tool: 'mcp__flow__steps',
    steps: [
      { text: 'Read the auth module', status: 'completed' },
      { text: 'Patch the token refresh', status: 'in_progress' },
      { text: 'Add a regression test', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/a.ts', content: 'x' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Fix the login bug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 Patch the token refresh/ })).toBeDefined()
  // The step list is Claude's own tool and is not counted as work.
  expect(await ui.find({ type: 'Text', text: /^1 tool$/ })).toBeDefined()
  await ui.unmount()
})

test('a turn nobody typed carries the job on, and the band leaves when the work is over', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'Ship it', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: 'Ship it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ answer: 'waiting', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await $.turn.start({ text: '<agent-message from="a1">done</agent-message>', turnId: 'turn-2' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Ship it/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ answer: 'all done', durationMs: 10, isAborted: false, turnId: 'turn-2', reason: 'answer' })
  const idle = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await idle.find({ type: 'Text', text: /Ship it/ })).toBeUndefined()
  await idle.unmount()
})

test('the pane lists a subagent with its tools, and the files touched under their folder', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Explore', turnId: 'turn-1' })
  await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'List the files',
    description: 'List files',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  // A call made inside the subagent's loop carries its id.
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/a.ts', agentId: 'agent-1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/a.ts', content: 'x' })
  await $.turn.complete({ answer: 'Found one file.', durationMs: 900, isAborted: false, turnId: 'turn-9', reason: 'answer', agentId: 'agent-1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'agent:agent-1' }))?.text).toContain('Explore')
  expect(await ui.find({ type: 'Text', text: /done · 1 tool/ })).toBeDefined()
  await ui.press({ key: 'agent:agent-1' })
  expect(await ui.find({ type: 'Text', text: /Found one file\./ })).toBeDefined()
  await ui.press({ key: 'tab:files' })
  expect(await ui.find({ type: 'Text', text: 'src/' })).toBeDefined()
  expect((await ui.find({ key: 'file:/work/app/src/a.ts' }))?.text).toContain('W a.ts')
  await ui.unmount()
})

test('task lists are read from every tool that keeps one', () => {
  const todos = tasksOfTodos([{ content: 'One', status: 'completed', activeForm: 'Doing one' }, { text: 'Two', status: 'in_progress' }])
  expect(todos.map(task => `${task.id}:${task.text}:${task.status}`)).toEqual(['1:One:completed', '2:Two:in_progress'])

  const made = taskCreated(taskCreated([], '7', 'Plan', 'Planning'), '8', 'Build', 'Building')
  const moved = taskUpdated(made, '7', { status: 'completed' })
  expect(progressOf(moved)).toEqual({ done: 1, total: 2, percent: 50, current: -1 })
  expect(taskUpdated(moved, '8', { status: 'deleted' })).toHaveLength(1)
})

test('a long list shows a window around the step in progress', () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1),
    text: `Step ${index + 1}`,
    activeForm: '',
    status: index < 6 ? ('completed' as const) : index === 6 ? ('in_progress' as const) : ('pending' as const),
  }))
  const shown = windowOf(tasks, 4)

  expect(shown.from).toBe(5)
  expect(shown.shown.map(task => task.id)).toEqual(['6', '7', '8', '9'])
  expect(shown.hidden).toBe(6)
  expect(barOf(10, 50)).toEqual({ full: '█████', rest: '░░░░░' })
})

test('touched files keep their strongest mark and group by folder', () => {
  let files = touched([], '/w/src/a.ts', 'R', '', 1, false)
  files = touched(files, '/w/src/a.ts', 'E', 'agent-1', 2, false)
  files = touched(files, '/w/README.md', 'W', '', 3, true)
  const rows = treeOf(files, '/w', false)

  expect(rows.map(row => (row.kind === 'dir' ? row.name : `${row.file.ops} ${row.name}`))).toEqual(['./', 'W README.md', 'src/', 'RE a.ts'])
  expect(files.find(file => file.path === '/w/src/a.ts')?.agents).toEqual(['agent-1'])
  expect(describeCall('Bash', { command: 'npm   test\n--watch' }, '/w')).toBe('Bash npm test --watch')
  expect(describeCall('Read', { file_path: '/w/src/a.ts' }, '/w')).toBe('Read src/a.ts')
})

test('an agent type keeps one mark, whether built in or not', () => {
  expect(designOf('Explore')).toEqual({ glyph: '◈', color: 'cyan' })
  expect(designOf('my-plugin:reviewer')).toEqual(designOf('my-plugin:reviewer'))
})
