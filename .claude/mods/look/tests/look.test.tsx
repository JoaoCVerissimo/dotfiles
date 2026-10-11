import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { SKINS, autoSkin, slugOf, themeIn, themeOf, withTheme } from '../hooks/lib/skins'

const ROW = {
  plugin: 'look',
  component: 'ToolUse',
  requestId: 'toolu_1',
  viewport: { columns: 150, rows: 40 },
  props: { tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
} as const

const PANE = {
  plugin: 'look',
  component: 'Pane',
  requestId: 'look',
  viewport: { columns: 150, rows: 40 },
  props: { title: 'Skins', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function world(on: On, files: Map<string, string>): void {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.start', () => ({ cwd: '/work/shop' }))
  on('session.root', () => ({ value: '/work/shop' }))
  on('settings.read', () => ({ value: { theme: 'dark' } }))
  on('command.register', () => ({ value: { command: 'skin' } }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) {
      return { deny: 'ENOENT' }
    }

    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine row'] }))
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/shop' } as const

test('zen hides a tool row and keeps one that failed', { options: { zen: true } }, async ($, on) => {
  world(on, new Map())
  await $.session.start(START)

  const quiet = await $.ui.mount({ ...ROW, surface: 'terminal' })
  expect(await quiet.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
  await quiet.unmount()

  const failed = await $.ui.mount({ ...ROW, surface: 'terminal', props: { ...ROW.props, isErrored: true } })
  expect(await failed.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await failed.unmount()
})

test('without zen the rows are Claude Code\'s own', async ($, on) => {
  world(on, new Map())
  await $.session.start(START)
  const row = await $.ui.mount({ ...ROW, surface: 'terminal' })

  expect(await row.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await row.unmount()
})

test('picking a skin writes the project\'s theme file and names it in the project\'s local settings', async ($, on) => {
  const files = new Map<string, string>([['/work/shop/.claude/settings.local.json', '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n']])
  world(on, files)
  await $.session.start(START)
  const slug = slugOf('/work/shop')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'skin:ocean' })

  const theme = JSON.parse(files.get(`/home/me/.claude/themes/${slug}.json`) ?? '{}')
  expect(theme.base).toBe('dark')
  expect(theme.overrides.promptBorder).toBe('#4fc3f7')
  const local = JSON.parse(files.get('/work/shop/.claude/settings.local.json') ?? '{}')
  expect(local).toEqual({ permissions: { allow: ['Bash(ls)'] }, theme: `custom:${slug}` })
  expect((await ui.find({ key: 'skin:ocean' }))?.text).toContain('●')

  await ui.press({ key: 'skin:none' })
  expect(JSON.parse(files.get('/work/shop/.claude/settings.local.json') ?? '{}')).toEqual({ permissions: { allow: ['Bash(ls)'] } })
  expect(JSON.parse(files.get(`/home/me/.claude/themes/${slug}.json`) ?? '{}').overrides).toEqual({})
  await ui.unmount()
})

test('a project keeps one theme name, and an unasked skin is the same every time', () => {
  expect(slugOf('/Users/me/Developer/My Shop')).toBe(slugOf('/Users/me/Developer/My Shop'))
  expect(slugOf('/Users/me/Developer/My Shop')).toMatch(/^proj-my-shop-[a-z0-9]{5}$/)
  expect(slugOf('/a/shop')).not.toBe(slugOf('/b/shop'))
  expect(autoSkin('/a/shop').id).toBe(autoSkin('/a/shop').id)
  expect(new Set(SKINS.map(skin => skin.id)).size).toBe(SKINS.length)
})

test('local settings are edited as JSON, and left alone when they are not', () => {
  expect(JSON.parse(withTheme('', 'custom:x', 'custom:x') ?? '')).toEqual({ theme: 'custom:x' })
  expect(JSON.parse(withTheme('{"theme":"custom:x","env":{}}', null, 'custom:x') ?? '')).toEqual({ env: {} })
  // Someone else's theme is not this mod's to clear.
  expect(JSON.parse(withTheme('{"theme":"light"}', null, 'custom:x') ?? '')).toEqual({ theme: 'light' })
  expect(withTheme('{ not json', 'custom:x', 'custom:x')).toBeNull()
  expect(themeIn('{"theme":"custom:x"}')).toBe('custom:x')
  expect(JSON.parse(themeOf('/work/shop', undefined)).name).toBe('shop')
})
