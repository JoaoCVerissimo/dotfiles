import type { Elements, RenderElement } from 'claude-code'

import type {
  ModsLive,
  ModsPrefs,
  ModsRoster,
  ModsRow,
  ModsSessionRow,
  ModsSwitches,
  ModsTab,
  ModsTurn,
  ModsView,
} from '../../types'
import type { External, Feature, Usage } from './catalog'
import {
  EFFORTS,
  EXTERNAL,
  FEATURES,
  USAGE_LABEL,
  ago,
  alwaysOf,
  baseName,
  clip,
  effortLine,
  externalRows,
  isOnHere,
  pickedModel,
  rowOf,
  savedLine,
  settingsOf,
} from './catalog'

// The elements the panel draws with, which the terminal and the desktop both have.
export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>

export type PanelData = {
  width: number
  view: ModsView
  switches: ModsSwitches
  rows: readonly ModsRow[]
  plugins: Readonly<Record<string, boolean>>
  live: ModsLive
  turn: ModsTurn
  roster: ModsRoster
  prefs: ModsPrefs
  note: string
  now: number
}

// What a press does. Each closes over the engine in the hooks module.
export type PanelActions = {
  tab: (tab: ModsTab) => void
  detail: (id: string | null) => void
  here: (feature: Feature) => void
  follow: (feature: Feature) => void
  always: (feature: Feature) => void
  external: (external: External) => void
  setRow: (row: ModsRow, value: boolean | string) => void
  run: (command: string, args?: string) => void
  stop: () => void
  openSession: (row: ModsSessionRow) => void
  archive: (row: ModsSessionRow) => void
  refreshSessions: () => void
  showArchived: () => void
}

const TABS: ReadonlyArray<{ id: ModsTab; title: string }> = [
  { id: 'mods', title: 'Mods' },
  { id: 'control', title: 'Control' },
  { id: 'sessions', title: 'Sessions' },
]

// Nothing in the panel acts on a single key: a control is clicked, or reached
// with tab and pressed with enter, so a stray key never switches anything.

// The icon on a session's row that archives it, and the one that brings it back.
const ARCHIVE_ICON = '⊟'
const RESTORE_ICON = '⊞'
const ACTION_MARK = '▸'

const USAGE_COLUMNS = Math.max(...Object.values(USAGE_LABEL).map(label => label.length))

function dot(t: Kit, isOn: boolean): RenderElement {
  return <t.Text color={isOn ? 'success' : 'inactive'}>{isOn ? '●' : '○'}</t.Text>
}

// What a mod costs, as the short tag its row ends with.
function usageTag(t: Kit, usage: Usage): RenderElement {
  const label = USAGE_LABEL[usage.level].padStart(USAGE_COLUMNS)

  return usage.level === 'tokens' ? <t.Text color="warning">{label}</t.Text> : <t.Text dimColor={usage.level === 'none'}>{label}</t.Text>
}

function usageNote(t: Kit, usage: Usage): RenderElement {
  return (
    <t.Box flexDirection="column">
      {heading(t, 'Usage', USAGE_LABEL[usage.level])}
      <t.Text dimColor wrap="wrap">
        {usage.note}
      </t.Text>
    </t.Box>
  )
}

function heading(t: Kit, title: string, value?: string): RenderElement {
  return (
    <t.Box flexDirection="row" columnGap={1} marginTop={1}>
      <t.Text bold color="claude">
        {title}
      </t.Text>
      {value !== undefined && <t.Text wrap="truncate-end">{value}</t.Text>}
    </t.Box>
  )
}

function drawMods(t: Kit, data: PanelData, act: PanelActions): RenderElement {
  const { Box, Text, Button } = t

  return (
    <Box flexDirection="column">
      {FEATURES.map(feature => {
        const always = alwaysOf(feature, data.rows)
        const isOn = isOnHere(feature, data.switches, data.rows)
        const override = data.switches[feature.id]
        const hint =
          always === null
            ? 'not loaded'
            : override !== undefined && override !== always
              ? `${override ? 'on' : 'off'} here only · ${feature.blurb}`
              : feature.blurb

        return (
          <Box key={`row:${feature.id}`} flexDirection="row" columnGap={1}>
            <Button key={`here:${feature.id}`} plain onPress={() => act.here(feature)}>
              {dot(t, isOn)} {feature.title.padEnd(10)}
            </Button>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {hint}
              </Text>
            </Box>
            <Button key={`more:${feature.id}`} plain onPress={() => act.detail(feature.id)}>
              {usageTag(t, feature.usage)} ›
            </Button>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>from Anthropic · every session</Text>
      </Box>
      {EXTERNAL.map(external => {
        const isOn = data.plugins[external.plugin] === true

        return (
          <Box key={`row:${external.id}`} flexDirection="row" columnGap={1}>
            <Button key={`ext:${external.id}`} plain onPress={() => act.external(external)}>
              {dot(t, isOn)} {external.title.padEnd(15)}
            </Button>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {external.plugin in data.plugins ? external.blurb : `not installed · ${external.blurb}`}
              </Text>
            </Box>
            <Button key={`more:${external.id}`} plain onPress={() => act.detail(external.id)}>
              {usageTag(t, external.usage)} ›
            </Button>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          every mod starts off · click its name to switch it for this session · the right side opens its switch for every session, its settings and what it uses
        </Text>
      </Box>
    </Box>
  )
}

function drawSetting(t: Kit, row: ModsRow, act: PanelActions): RenderElement {
  const { Box, Text, Button, Input } = t
  if (row.kind === 'boolean') {
    return (
      <Box flexDirection="column">
        <Button key={`set:${row.key}`} plain onPress={() => act.setRow(row, row.value !== true)}>
          {dot(t, row.value === true)} {row.label}
        </Button>
        {row.description !== '' && (
          <Text dimColor wrap="wrap">
            {`  ${row.description}`}
          </Text>
        )}
      </Box>
    )
  }
  if (row.kind === 'choice') {
    return (
      <Box flexDirection="column">
        <Text>{row.label}</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
          {row.options.map(option => (
            <Button key={`set:${row.key}:${option}`} plain onPress={() => act.setRow(row, option)}>
              {dot(t, row.value === option)} {option}
            </Button>
          ))}
        </Box>
        {row.description !== '' && (
          <Text dimColor wrap="wrap">
            {`  ${row.description}`}
          </Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Input
        key={`set:${row.key}`}
        label={row.label}
        value={String(row.value)}
        submitLabel="save"
        onSubmit={value => act.setRow(row, value)}
      />
      {row.description !== '' && (
        <Text dimColor wrap="wrap">
          {`  ${row.description}`}
        </Text>
      )}
    </Box>
  )
}

function drawDetail(t: Kit, data: PanelData, act: PanelActions, id: string): RenderElement {
  const { Box, Text, Button } = t
  const feature = FEATURES.find(one => one.id === id)
  const external = EXTERNAL.find(one => one.id === id)
  const back = <Button key="back" plain label="‹ back" onPress={() => act.detail(null)} />

  if (feature !== undefined) {
    const always = alwaysOf(feature, data.rows)
    const isOn = isOnHere(feature, data.switches, data.rows)
    const override = data.switches[feature.id]
    const settings = settingsOf(feature, data.rows)

    return (
      <Box flexDirection="column">
        {back}
        {heading(t, feature.title, feature.blurb)}
        <Box flexDirection="row" columnGap={2}>
          <Button key="here" plain onPress={() => act.here(feature)}>
            {dot(t, isOn)} this session
          </Button>
          {override !== undefined && (
            <Button key="follow" plain dimColor label="follow always" onPress={() => act.follow(feature)} />
          )}
        </Box>
        {always === null ? (
          <Text dimColor wrap="wrap">
            {`The ${feature.plugin} mod is not loaded, so it has no always switch. Install or enable it first.`}
          </Text>
        ) : (
          <Button key="always" plain onPress={() => act.always(feature)}>
            {dot(t, always)} always, in every session
          </Button>
        )}
        {feature.command !== undefined && always !== null && (
          <Button key="open" plain label={`${ACTION_MARK} open /${feature.command}`} onPress={() => act.run(feature.command ?? '')} />
        )}
        {usageNote(t, feature.usage)}
        {settings.length > 0 && heading(t, 'Settings')}
        {settings.map(row => drawSetting(t, row, act))}
      </Box>
    )
  }
  if (external !== undefined) {
    const isOn = data.plugins[external.plugin] === true
    const settings = externalRows(external, data.rows)

    return (
      <Box flexDirection="column">
        {back}
        {heading(t, external.title, external.blurb)}
        <Button key="always" plain onPress={() => act.external(external)}>
          {dot(t, isOn)} on, in every session
        </Button>
        <Text dimColor wrap="wrap">
          {`${external.plugin} ships as it is, so it has no switch of its own for one session.`}
        </Text>
        {usageNote(t, external.usage)}
        {settings.length > 0 && heading(t, 'Settings')}
        {settings.map(row => drawSetting(t, row, act))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {back}
      <Text dimColor>Nothing here.</Text>
    </Box>
  )
}

function drawControl(t: Kit, data: PanelData, act: PanelActions): RenderElement {
  const { Box, Text, Button, Input } = t
  const model = rowOf(data.rows, 'model')
  const onModel = pickedModel(model)
  const chips = rowOf(data.rows, 'mods.chips')
  const isWorking = data.turn !== null
  const pick = (label: string, isPicked: boolean, key: string, onPress: () => void): RenderElement => (
    <Button key={key} plain onPress={onPress}>
      {dot(t, isPicked)} {label}
    </Button>
  )
  // A command to run now, under the mark that sets a button apart from the words around it.
  const action = (label: string, command: string): RenderElement => (
    <Button key={`run:${command}`} plain label={`${ACTION_MARK} ${label}`} onPress={() => act.run(command)} />
  )

  return (
    <Box flexDirection="column">
      {heading(t, 'Model', data.live.model)}
      {model !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={1}>
          {model.options.map(option =>
            pick(option, onModel === option, `model:${option}`, () => act.run('model', option)),
          )}
        </Box>
      )}
      {heading(t, 'Effort', effortLine(data.live))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={1}>
        {EFFORTS.map(level =>
          pick(level, data.live.effort === level, `effort:${level}`, () => act.run('effort', level)),
        )}
      </Box>
      <Box paddingLeft={1}>
        <Text dimColor wrap="wrap">
          {savedLine(data.live)}
        </Text>
      </Box>
      {heading(t, 'Turn', isWorking ? 'working' : 'idle')}
      <Box paddingLeft={1}>
        <Button key="stop" plain dimColor={!isWorking} onPress={() => act.stop()}>
          <Text color={isWorking ? 'error' : 'inactive'}>■</Text> stop this turn
        </Button>
      </Box>
      {heading(t, 'Do')}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={1}>
        {action('focus view', 'focus')}
        {action('fast mode', 'fast')}
        {action('context', 'context')}
        {action('usage', 'usage')}
        {action('recap', 'recap')}
        {action('compact', 'compact')}
        {action('new chat', 'clear')}
      </Box>
      <Box paddingLeft={1}>
        <Input
          key="rename"
          label="Rename"
          placeholder="a name for this session"
          value=""
          submitLabel="rename"
          onSubmit={value => {
            if (value.trim() !== '') {
              act.run('rename', value.trim())
            }
          }}
        />
      </Box>
      {chips !== undefined && heading(t, 'Panel')}
      {chips !== undefined && (
        <Box paddingLeft={1}>
          <Button key="chips" plain onPress={() => act.setRow(chips, chips.value !== true)}>
            {dot(t, chips.value === true)} quick buttons under the prompt
          </Button>
        </Box>
      )}
    </Box>
  )
}

function drawSessions(t: Kit, data: PanelData, act: PanelActions): RenderElement {
  const { Box, Text, Button } = t
  const archived = new Set(data.prefs.archived)
  const shown = data.roster.rows.filter(row => data.prefs.showArchived || !archived.has(row.key))
  const hidden = data.roster.rows.length - shown.length
  const room = Math.max(12, data.width - 12)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Button key="refresh" plain label="↻ refresh" onPress={() => act.refreshSessions()} />
        <Button key="archived" plain onPress={() => act.showArchived()}>
          {dot(t, data.prefs.showArchived)} archived{hidden > 0 ? ` (${hidden})` : ''}
        </Button>
      </Box>
      {data.roster.error !== '' && (
        <Text color="warning" wrap="wrap">
          {data.roster.error}
        </Text>
      )}
      {shown.length === 0 && data.roster.error === '' && (
        <Text dimColor>{data.roster.at === 0 ? 'Loading…' : 'No sessions to show.'}</Text>
      )}
      {shown.map(row => {
        const isArchived = archived.has(row.key)
        const where = baseName(row.cwd) || '~'
        const state = row.waitingFor !== '' ? `waits: ${row.waitingFor}` : row.status
        const age = row.at > 0 ? ago(Math.max(0, data.now - row.at)) : ''

        return (
          <Box key={`row:${row.key}`} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`open:${row.key}`} plain dimColor={isArchived} onPress={() => act.openSession(row)}>
                  <Text color={row.isLive ? 'success' : 'inactive'}>{row.isLive ? '●' : '○'}</Text> {clip(row.name, room)}
                  {row.isSelf && <Text color="claude"> · here</Text>}
                </Button>
              </Box>
              {!row.isSelf && (
                <Button key={`arch:${row.key}`} dimColor label={isArchived ? RESTORE_ICON : ARCHIVE_ICON} onPress={() => act.archive(row)} />
              )}
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor wrap="truncate-end">
                {`${where} · ${state}${age === '' ? '' : ` · ${age}`}`}
              </Text>
            </Box>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          {`click a session to open it: its terminal tab if it has one, else it is resumed here · ${ARCHIVE_ICON} archives one, which only hides its row · ${RESTORE_ICON} brings it back`}
        </Text>
      </Box>
    </Box>
  )
}

export function drawPanel(t: Kit, data: PanelData, act: PanelActions): RenderElement {
  const { Box, Text, Button } = t
  const { view } = data
  const body =
    view.tab === 'control'
      ? drawControl(t, data, act)
      : view.tab === 'sessions'
        ? drawSessions(t, data, act)
        : view.detail === null
          ? drawMods(t, data, act)
          : drawDetail(t, data, act, view.detail)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        {TABS.map(tab => (
          <Button key={`tab:${tab.id}`} plain label={tab.title} dimColor={view.tab !== tab.id} onPress={() => act.tab(tab.id)}>
            {view.tab === tab.id ? (
              <Text bold color="claude">
                {tab.title}
              </Text>
            ) : (
              tab.title
            )}
          </Button>
        ))}
      </Box>
      {data.note !== '' && (
        <Text color="warning" wrap="wrap">
          {data.note}
        </Text>
      )}
      <Box flexDirection="column" marginTop={view.tab === 'mods' ? 1 : 0}>
        {body}
      </Box>
    </Box>
  )
}

// The buttons on the hint line under the prompt. The engine keeps its mode
// label in a column to the left and wraps a tree wider than what is left of
// the row, so the tree is sized to that room and draws the hint text itself.
const MODE_LABEL_COLUMNS = 28

export function drawChips(
  t: Pick<Kit, 'Box' | 'Text' | 'Button'>,
  hint: string,
  columns: number,
  isWorking: boolean,
  act: Pick<PanelActions, 'tab' | 'stop'>,
): RenderElement {
  const { Box, Text, Button } = t
  const isWide = columns >= 90

  return (
    <Box flexDirection="row" width={Math.max(24, columns - MODE_LABEL_COLUMNS)} justifyContent="space-between" columnGap={2}>
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {hint.split('\n')[0] ?? ''}
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        {isWorking && (
          <Button key="chip:stop" plain onPress={() => act.stop()}>
            <Text color="error">■</Text> stop
          </Button>
        )}
        <Button key="chip:mods" plain dimColor onPress={() => act.tab('mods')}>
          <Text color="claude">◆</Text> mods
        </Button>
        {isWide && <Button key="chip:control" plain dimColor label="control" onPress={() => act.tab('control')} />}
        {isWide && <Button key="chip:sessions" plain dimColor label="sessions" onPress={() => act.tab('sessions')} />}
      </Box>
    </Box>
  )
}
