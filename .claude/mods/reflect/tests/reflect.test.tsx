import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { LEARNED_HEADING, cleanRule, explicitRule, hasSecret, isCandidate, parseVerdict, withRule } from '../hooks/lib/rules'

const BAND = {
  plugin: 'reflect',
  component: 'AbovePrompt',
  viewport: { columns: 150, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type World = { clock: MockClock; files: Map<string, string>; judged: string[]; sent: Array<readonly string[] | undefined> }

function world(on: On, verdict: string): World {
  const clock = mock.clock(on, { now: 7_000_000 })
  const files = new Map<string, string>()
  const judged: string[] = []
  const sent: Array<readonly string[] | undefined> = []
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.start', () => ({ cwd: '/work/shop' }))
  on('session.root', () => ({ value: '/work/shop' }))
  on('command.register', () => ({ value: { command: 'reflect' } }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'I ran npm install.', toolUses: [] }] }))
  on('model.complete', ($, e) => {
    judged.push(e.prompt)

    return { value: { isAnswered: true, text: verdict, usage: USAGE } }
  })
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    sent.push(e.context)

    return { text: e.text }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))

  return { clock, files, judged, sent }
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/shop' } as const
const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as const

test('a correction becomes a rule you can save for the project, and Claude hears it with the next prompt', async ($, on) => {
  const { clock, files, judged, sent } = world(on, '{"is_rule": true, "rule": "Use pnpm, never npm, in this repository.", "scope": "project", "confidence": 0.9}')
  await $.session.start(START)
  await $.prompt.submit(typed("No, don't use npm here, we always use pnpm"))
  await clock.settle()

  expect(judged).toHaveLength(1)
  expect(judged[0]).toContain('<user_message>No, don\'t use npm here')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Use pnpm, never npm, in this repository\./ })).toBeDefined()
  await ui.press({ key: 'reflect:project' })
  expect(files.get('/work/shop/CLAUDE.local.md')).toBe(`${LEARNED_HEADING}\n\n- Use pnpm, never npm, in this repository.\n`)
  // Saved: the band has nothing left to offer.
  expect(await ui.find({ key: 'reflect:project' })).toBeUndefined()
  await ui.unmount()

  await $.prompt.submit(typed('carry on'))
  expect(sent.at(-1)?.join('\n')).toContain('- Use pnpm, never npm, in this repository.')
  await $.prompt.submit(typed('and again'))
  expect(sent.at(-1)).toBeUndefined()
})

test('remember: needs no model, and saving everywhere writes the user rules file', async ($, on) => {
  const { clock, files, judged } = world(on, 'not json')
  await $.session.start(START)
  await $.prompt.submit(typed('remember: answer in British English'))
  await clock.settle()

  expect(judged).toHaveLength(0)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Nothing here answers a single key: every control is clicked.
  expect((await ui.findAll({ type: 'Button' })).filter(button => button.props.hotkey !== undefined)).toEqual([])
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
  await ui.press({ key: 'reflect:global' })
  expect(files.get('/home/me/.claude/rules/learned.md')).toContain(`${LEARNED_HEADING}\n\n- answer in British English\n`)
  await ui.unmount()
})

test('an ordinary request, a secret, or a doubtful verdict offers nothing', async ($, on) => {
  const { clock, judged } = world(on, '{"is_rule": true, "rule": "Maybe use tabs.", "scope": "project", "confidence": 0.4}')
  await $.session.start(START)
  await $.prompt.submit(typed('add a login page with a form'))
  await $.prompt.submit(typed('never print the token sk-abcdefghijklmnopqrstuv in logs'))
  await $.prompt.submit(typed('from now on prefer tabs I guess'))
  await clock.settle()

  // Only the last one reads like a preference and is safe to send; its verdict is too unsure to offer.
  expect(judged).toHaveLength(1)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'reflect:skip' })).toBeUndefined()
  await ui.unmount()
})

test('explicit mode only listens for remember:', { options: { detect: 'explicit' } }, async ($, on) => {
  const { clock, judged } = world(on, '{"is_rule": true, "rule": "Use pnpm.", "scope": "project", "confidence": 0.9}')
  await $.session.start(START)
  await $.prompt.submit(typed("don't use npm, always use pnpm"))
  await clock.settle()

  expect(judged).toHaveLength(0)
})

test('prompts are sifted before any model sees them', () => {
  expect(isCandidate("No, don't mock the database in these tests")).toBe(true)
  expect(isCandidate('from now on, run the linter before committing')).toBe(true)
  expect(isCandidate('add a dark mode toggle to the settings page')).toBe(false)
  expect(isCandidate('/compact')).toBe(false)
  expect(isCandidate(`never ${'x'.repeat(700)}`)).toBe(false)
  expect(hasSecret('use ghp_abcdefghijklmnopqrstuvwxyz0123 for the API')).toBe(true)
  expect(explicitRule('  Remember:  use   pnpm ')).toBe('use pnpm')
  expect(explicitRule('remember the milk')).toBeNull()
  expect(cleanRule('- Keep it short <!-- x -->')).toBeNull()
})

test('a verdict is taken only when it is sure and well formed', () => {
  expect(parseVerdict('Sure: {"is_rule": true, "rule": "Run tests first.", "scope": "global", "confidence": 0.8}')).toEqual({ rule: 'Run tests first.', scope: 'global' })
  expect(parseVerdict('{"is_rule": false, "rule": "", "scope": "project", "confidence": 0.9}')).toBeNull()
  expect(parseVerdict('{"is_rule": true, "rule": "x", "confidence": 0.69}')).toBeNull()
  expect(parseVerdict('no json here')).toBeNull()
})

test('a rule lands under the learned-rules heading, once', () => {
  const fresh = withRule('', 'Use pnpm.', '# Mine\n\n')
  expect(fresh).toBe(`# Mine\n\n${LEARNED_HEADING}\n\n- Use pnpm.\n`)

  const grown = withRule(`# Project\n\nNotes.\n\n${LEARNED_HEADING}\n\n- Use pnpm.\n\n## After\n\nMore.\n`, 'Run the linter.', '')
  expect(grown).toBe(`# Project\n\nNotes.\n\n${LEARNED_HEADING}\n\n- Use pnpm.\n- Run the linter.\n\n## After\n\nMore.\n`)

  expect(withRule(`${LEARNED_HEADING}\n\n- Use pnpm.\n`, 'use PNPM', '')).toBeNull()
  expect(withRule('# Project\n\nNotes.\n', 'Use pnpm.', '')).toBe(`# Project\n\nNotes.\n\n${LEARNED_HEADING}\n\n- Use pnpm.\n`)
})
