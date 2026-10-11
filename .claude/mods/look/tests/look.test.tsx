import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock, Plugin } from 'claude-code/testing'

import { SKINS, autoSkin, skinOf, slugOf, themeIn, themeOf, withTheme } from '../hooks/lib/skins'

// The panel as Look sees it: the switches it keeps for the session, flipped here by a command.
const PANEL: Plugin = {
  name: 'mods',
  register(on) {
    on('command.run', { command: 'flip' }, async ($, e) => {
      await $.state.set({ plugin: 'mods', key: 'switches' } as const, JSON.parse(e.args))

      return {}
    })
  },
}

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

const LOCAL = '/work/shop/.claude/settings.local.json'
const THEME = `/home/me/.claude/themes/${slugOf('/work/shop')}.json`

// A project that already has a skin: its theme file, the line naming it, and the pick the mod kept.
function skinned(id: string): Map<string, string> {
  return new Map([
    [THEME, themeOf('/work/shop', skinOf(id))],
    [LOCAL, `{\n  "theme": "custom:${slugOf('/work/shop')}"\n}\n`],
  ])
}

// Settings name the theme Claude Code would start a session on: the project's line when it has one.
function world(on: On, files: Map<string, string>, picks: Record<string, string> = {}): MockClock {
  const clock = mock.clock(on)
  mock.store(on, { skins: picks })
  mock.env(on, { HOME: '/home/me' })
  on('session.start', () => ({ cwd: '/work/shop' }))
  on('session.root', () => ({ value: '/work/shop' }))
  on('settings.read', () => ({ value: { theme: themeIn(files.get(LOCAL) ?? '') || 'dark' } }))
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

  return clock
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

test('skins are off until switched on: /skin says where the switch is and writes nothing', async ($, on) => {
  const files = new Map<string, string>()
  world(on, files)
  await $.session.start(START)
  const skin = (args: string) => ({ command: 'skin', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } }) as const

  expect((await $.command.run(skin('ocean'))).text).toBe('Skins are off here; switch them on in the mods panel, or with /mods skins on.')
  expect((await $.command.run(skin(''))).text).toBe('Skins are off here; switch them on in the mods panel, or with /mods skins on.')
  expect([...files.keys()]).toEqual([])
})

test('picking a skin writes the project\'s theme file and names it in the project\'s local settings', { options: { skins: true } }, async ($, on) => {
  const files = new Map<string, string>([['/work/shop/.claude/settings.local.json', '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n']])
  world(on, files)
  await $.session.start(START)
  const slug = slugOf('/work/shop')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Nothing here answers a single key: every control is clicked.
  expect((await ui.findAll({ type: 'Button' })).filter(button => button.props.hotkey !== undefined)).toEqual([])
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

const typed = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } }) as const

test('a first pick changes nothing in the session it is made in, and says so, even after a reload', { options: { skins: true } }, async ($, on) => {
  const files = new Map<string, string>()
  world(on, files)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'This session started without the project\'s skin' })).toBeDefined()

  await ui.press({ key: 'skin:forest' })
  expect(await ui.find({ type: 'Text', text: 'Forest is saved for shop. It shows in the next session started in this folder' })).toBeDefined()
  await ui.unmount()

  // The pick put the project's theme in settings; a reload must not take that for the theme the session started on.
  await $.session.start(START)
  expect((await $.command.run(typed('skin', 'ocean'))).text).toContain('Ocean is saved for shop. It shows in the next session started in this folder')
})

test('a session that started on the project\'s theme is recolored by a pick at once', { options: { skins: true } }, async ($, on) => {
  const files = skinned('forest')
  world(on, files, { '/work/shop': 'forest' })
  await $.session.start(START)

  expect((await $.command.run(typed('skin', 'ocean'))).text).toBe('shop wears Ocean.')
  expect(JSON.parse(files.get(THEME) ?? '{}').overrides.promptBorder).toBe('#4fc3f7')
})

test('a project keeps its skin through a session that starts with skins off', async ($, on) => {
  const files = skinned('forest')
  const before = files.get(THEME)
  world(on, files, { '/work/shop': 'forest' })
  await $.session.start(START)

  expect(files.get(THEME)).toBe(before)
})

test('switching skins off in a session turns the project plain, and on again brings its skin back', { plugins: [PANEL] }, async ($, on) => {
  const files = skinned('forest')
  const clock = world(on, files, { '/work/shop': 'forest' })
  await $.session.start(START)
  // The theme file's colors once a flip of the panel's switches has been followed.
  const flipped = async (switches: string) => {
    await $.command.run(typed('flip', switches))
    await clock.settle()

    return JSON.parse(files.get(THEME) ?? '{}').overrides
  }

  expect((await flipped('{"skins":true}')).promptBorder).toBe('#81c784')
  expect(await flipped('{"skins":false}')).toEqual({})
  // Another mod's switch is no reason to touch the theme.
  expect(await flipped('{"skins":false,"zen":true}')).toEqual({})
  expect((await flipped('{"skins":true,"zen":true}')).promptBorder).toBe('#81c784')
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
