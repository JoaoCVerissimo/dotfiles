// Look: Zen mode and per-project skins.
//
// Zen hides the transcript's tool rows (calls, results, groups, the
// run-in-background hint) while it is on; a failed call still shows unless
// told otherwise. Nothing Claude reads changes.
//
// A skin is a Claude Code theme of the project's own. Each project that has
// one gets a theme file in ~/.claude/themes/ and a `theme` line in its
// .claude/settings.local.json naming it, which is how Claude Code itself
// picks a theme per project. Claude Code reloads a theme file when it
// changes, so once a session has started on the project's theme, picking
// another skin recolors it at once; the first pick shows from the next start.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { LookProject } from '../types'
import { SKINS, autoSkin, baseName, skinOf, slugOf, themeIn, themeOf, withTheme } from './lib/skins'

const PANE = 'look'
const HOTKEYS = 'abcdefghijklmnopqrstuvw'
const NONE: LookProject = { root: '', slug: '', skin: '', isLive: false, note: '' }

const project = atom({ plugin: 'look', key: 'project' } as const, NONE)
// The mods panel's switches for this session; absent when the panel is not loaded.
const switches = { plugin: 'mods', key: 'switches' } as const

let configDir = ''
// The theme this process started with: the one a change of skin can recolor live.
let startTheme: string | null = null

async function isZen($: EngineInterface, options: PluginOptions): Promise<boolean> {
  return (await read($, switches).catch(() => undefined))?.zen ?? options.zen === true
}

async function hasSkins($: EngineInterface, options: PluginOptions): Promise<boolean> {
  return (await read($, switches).catch(() => undefined))?.skins ?? options.skins !== false
}

function themePath(slug: string): string {
  return `${configDir}/themes/${slug}.json`
}

function localPath(root: string): string {
  return `${root}/.claude/settings.local.json`
}

// Writes the project's theme file as it should read now: its skin's colors
// while skins are on, the plain dark theme while they are off.
async function sync($: EngineInterface, options: PluginOptions): Promise<void> {
  const current = await read($, project)
  if (current.root === '' || current.skin === '') {
    return
  }
  const wanted = themeOf(current.root, (await hasSkins($, options)) ? skinOf(current.skin) : undefined)
  const held = await $.fs.read(themePath(current.slug)).catch(() => '')
  if (held !== wanted) {
    await $.fs.write(themePath(current.slug), wanted)
  }
}

async function pick($: EngineInterface, options: PluginOptions, id: string): Promise<string> {
  const current = await read($, project)
  if (current.root === '') {
    return 'No project here to skin.'
  }
  const skin = skinOf(id)
  const mine = `custom:${current.slug}`
  // The theme file first: the settings line must never name a theme that is not there.
  await $.fs.write(themePath(current.slug), themeOf(current.root, skin !== undefined && (await hasSkins($, options)) ? skin : undefined))
  const raw = await $.fs.read(localPath(current.root)).catch(() => '')
  const next = withTheme(raw, skin === undefined ? null : mine, mine)
  if (next === null) {
    return `${localPath(current.root)} is not JSON this can edit, so it was left alone.`
  }
  if (skin !== undefined || raw !== '') {
    await $.fs.write(localPath(current.root), next)
  }
  const saved = await $.store.get('skins').catch(() => undefined)
  const picks: Record<string, unknown> = typeof saved === 'object' && saved !== null ? { ...saved } : {}
  if (skin === undefined) {
    delete picks[current.root]
  } else {
    picks[current.root] = skin.id
  }
  await $.store.set('skins', picks).catch(() => undefined)
  const note =
    skin === undefined
      ? `${baseName(current.root)} has no skin now.`
      : current.isLive
        ? `${baseName(current.root)} wears ${skin.title}.`
        : `${baseName(current.root)} will wear ${skin.title} from the next session that starts here.`
  await update($, project, (old): LookProject => ({ ...old, skin: skin?.id ?? '', note }))

  return note
}

// Reads where this session is and what skin its project has.
async function load($: EngineInterface, options: PluginOptions, isFirst: boolean): Promise<void> {
  const root = await $.session.root().catch(() => '')
  if (root === '') {
    return
  }
  const slug = slugOf(root)
  const local = themeIn(await $.fs.read(localPath(root)).catch(() => ''))
  const saved = await $.store.get('skins').catch(() => undefined)
  const kept = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>)[root] : undefined
  const isMine = local === `custom:${slug}`
  const skin = isMine && typeof kept === 'string' && skinOf(kept) !== undefined ? kept : ''
  await update($, project, (): LookProject => ({ root, slug, skin, isLive: startTheme === `custom:${slug}`, note: '' }))
  if (skin !== '') {
    await sync($, options)
  } else if (isFirst && options.skinsAuto === true && local === '' && (await hasSkins($, options))) {
    await pick($, options, autoSkin(root).id)
  }
}

async function openPane($: EngineInterface): Promise<void> {
  const mine = (await $.ui.panes()).find(pane => pane.id === PANE)
  if (mine !== undefined && mine.isShown) {
    await $.ui.close({ id: PANE })

    return
  }
  await $.ui.open({ id: PANE, title: 'Skins', focus: true, columns: 44, rows: 16 })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    if (startTheme === null) {
      const theme = (await $.settings.read().catch(() => ({}) as Record<string, unknown>)).theme
      startTheme = typeof theme === 'string' ? theme : ''
    }
    await load($, options, true)
    await $.command
      .register({
        name: 'skin',
        description: 'Pick the color skin of this project, or open the skin picker',
        argumentHint: `[${SKINS.map(skin => skin.id).join('|')}|none]`,
        immediate: true,
      })
      .catch(error => $.ui.log(String(error), { to: 'debug' }))
    return next(e)
  })

  // /clear, /resume and /branch reset the state above and raise no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($, options, false)

    return next(e)
  })

  // The panel switched something for this session: the theme file follows the skins switch.
  on('state.set', { plugin: 'mods', key: 'switches' }, async ($, e, next) => {
    const result = await next(e)
    void sync($, options).catch(() => undefined)

    return result
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === '') {
      await openPane($)

      return {}
    }
    if (word === 'none' || word === 'off') {
      return { text: await pick($, options, '') }
    }
    const skin = SKINS.find(one => one.id === word)

    return { text: skin === undefined ? `No skin is called "${word}". Skins: ${SKINS.map(one => one.id).join(', ')}, none.` : await pick($, options, skin.id) }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await isZen($, options)) || (e.props.isErrored && options.zenErrors !== false)) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await isZen($, options)) || (e.props.isErrored && options.zenErrors !== false)) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const hasFailure = e.props.calls.some(call => call.isErrored)
    if (!(await isZen($, options)) || (hasFailure && options.zenErrors !== false)) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await isZen($, options))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, project)
    const isOn = await hasSkins($, options)

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold color="claude">
            Skin
          </Text>{' '}
          {current.root === '' ? 'no project' : baseName(current.root)}
        </Text>
        {!isOn && <Text color="warning">Skins are switched off, so the project shows the plain theme.</Text>}
        <Box flexDirection="column" marginTop={1}>
          {SKINS.map((skin, index) => (
            <Box flexDirection="row" columnGap={1}>
              <Button key={`skin:${skin.id}`} plain hotkey={HOTKEYS[index]} onPress={() => void pick($, options, skin.id)}>
                <Text color={current.skin === skin.id ? 'success' : 'inactive'}>{current.skin === skin.id ? '●' : '○'}</Text>{' '}
                {skin.title.padEnd(8)}
              </Button>
              <Text color={skin.accent}>████</Text>
              <Text color={skin.soft}>██</Text>
              <Text backgroundColor={skin.surface}>{' you '}</Text>
            </Box>
          ))}
          <Button key="skin:none" plain hotkey="x" onPress={() => void pick($, options, '')}>
            <Text color={current.skin === '' ? 'success' : 'inactive'}>{current.skin === '' ? '●' : '○'}</Text> none
          </Button>
        </Box>
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {current.note !== ''
              ? current.note
              : current.isLive
                ? 'A pick recolors this session at once.'
                : 'A first pick shows from the next session that starts in this project.'}
          </Text>
        </Box>
      </Box>
    )
  })
}
