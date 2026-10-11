import type { Elements, RenderElement } from 'claude-code'

import type { FlowAgent, FlowFile, FlowTask, FlowTurn, FlowView } from '../../types'
import { barOf, clip, designOf, markOf, oneLine, progressOf, relative, tokens, took, treeOf, windowOf } from './model'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const PIPS_SHOWN = 12
const AGENT_ROWS = 3

function mark(t: Kit, task: FlowTask): RenderElement {
  if (task.status === 'completed') {
    return <t.Text color="success">✔</t.Text>
  }

  return task.status === 'in_progress' ? <t.Text color="claude">◉</t.Text> : <t.Text color="inactive">○</t.Text>
}

export type BandData = {
  width: number
  turn: FlowTurn
  tasks: readonly FlowTask[]
  agents: readonly FlowAgent[]
  isCompact: boolean
  maxTasks: number
}

// The band above the prompt while a turn runs: what it is on, how far the
// task list is, the tasks by number, and the subagents at work.
export function drawBand(t: Kit, data: BandData, onOpen: () => void): RenderElement {
  const { Box, Text, Button } = t
  const { turn, tasks } = data
  const progress = progressOf(tasks)
  const running = data.agents.filter(agent => agent.status === 'running')
  const isDone = progress.total > 0 && progress.done === progress.total
  const barWidth = Math.max(8, Math.min(28, data.width - 62))
  const bar = barOf(barWidth, progress.percent)
  const stats = [
    `${turn.tools} tool${turn.tools === 1 ? '' : 's'}`,
    turn.failed > 0 ? `${turn.failed} failed` : '',
    running.length > 0 ? `${running.length} agent${running.length === 1 ? '' : 's'}` : '',
  ].filter(part => part !== '')
  const { from, shown, hidden } = windowOf(tasks, Math.max(1, data.maxTasks))

  return (
    <Box flexDirection="column" paddingRight={5}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={isDone ? 'success' : 'claude'}>{isDone ? '✔' : '◆'}</Text>{' '}
            <Text bold>{turn.title === '' ? 'Working' : turn.title}</Text>
          </Text>
        </Box>
        {progress.total > 0 && (
          <Box flexShrink={0}>
            <Text>
              <Text color={isDone ? 'success' : 'claude'}>{bar.full}</Text>
              <Text color="inactive">{bar.rest}</Text>
              {` ${progress.done}/${progress.total}`}
              <Text dimColor>{` ${progress.percent}%`}</Text>
            </Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Text dimColor>{stats.join(' · ')}</Text>
        </Box>
        <Box flexShrink={0}>
          <Button key="flow:open" plain dimColor label="▸ flow" onPress={onOpen} />
        </Box>
      </Box>
      {data.isCompact && progress.total > 0 && (
        <Box flexDirection="row" columnGap={1} paddingLeft={2}>
          {tasks.slice(0, PIPS_SHOWN).map((task, index) => (
            <Text dimColor={task.status === 'pending'}>
              {mark(t, task)}
              {String(index + 1)}
            </Text>
          ))}
          {tasks.length > PIPS_SHOWN && <Text dimColor>{`+${tasks.length - PIPS_SHOWN}`}</Text>}
        </Box>
      )}
      {!data.isCompact &&
        shown.map((task, index) => (
          <Box flexDirection="row" paddingLeft={2}>
            <Text wrap="truncate-end" dimColor={task.status !== 'in_progress'} bold={task.status === 'in_progress'}>
              {mark(t, task)}
              {` ${String(from + index + 1).padStart(2)} ${task.status === 'in_progress' && task.activeForm !== '' ? task.activeForm : task.text}`}
            </Text>
          </Box>
        ))}
      {!data.isCompact && hidden > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>{`   … ${hidden} more`}</Text>
        </Box>
      )}
      {running.slice(0, AGENT_ROWS).map(agent => {
        const design = designOf(agent.type)

        return (
          <Box flexDirection="row" paddingLeft={2}>
            <Text wrap="truncate-end">
              <Text color={design.color}>{design.glyph}</Text>
              {` ${agent.type} `}
              <Text dimColor>{`${oneLine(agent.description, 40)} · ${agent.last === '' ? 'starting' : agent.last}`}</Text>
            </Text>
          </Box>
        )
      })}
      {running.length > AGENT_ROWS && (
        <Box paddingLeft={2}>
          <Text dimColor>{`   … ${running.length - AGENT_ROWS} more agents`}</Text>
        </Box>
      )}
    </Box>
  )
}

export type PaneData = {
  width: number
  view: FlowView
  turn: FlowTurn | null
  tasks: readonly FlowTask[]
  agents: readonly FlowAgent[]
  files: readonly FlowFile[]
  root: string
  now: number
}

export type PaneActions = {
  tab: (tab: FlowView['tab']) => void
  agent: (id: string | null) => void
  copy: (path: string) => void
  open: (path: string) => void
  clear: () => void
}

const TABS: ReadonlyArray<{ id: FlowView['tab']; title: string }> = [
  { id: 'agents', title: 'Agents' },
  { id: 'files', title: 'Files' },
  { id: 'tasks', title: 'Tasks' },
]

function stateOf(agent: FlowAgent, now: number): string {
  const span = took((agent.endedAt === 0 ? now : agent.endedAt) - agent.startedAt)
  const used = agent.tokens > 0 ? ` · ${tokens(agent.tokens)} tok` : ''

  return `${agent.status} · ${agent.tools} tool${agent.tools === 1 ? '' : 's'} · ${span}${used}`
}

function drawAgents(t: Kit, data: PaneData, act: PaneActions): RenderElement {
  const { Box, Text, Button } = t
  const picked = data.view.agent === null ? undefined : data.agents.find(agent => agent.id === data.view.agent)
  if (picked !== undefined) {
    const design = designOf(picked.type)

    return (
      <Box flexDirection="column">
        <Button key="back" plain label="‹ back" onPress={() => act.agent(null)} />
        <Text wrap="wrap">
          <Text color={design.color}>{design.glyph}</Text> <Text bold>{picked.type}</Text>
          {picked.model === '' ? '' : ` · ${picked.model}`}
        </Text>
        <Text wrap="wrap">{picked.description}</Text>
        <Text dimColor>{stateOf(picked, data.now)}</Text>
        {picked.prompt !== '' && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="claude">
              Asked
            </Text>
            <Text dimColor wrap="wrap">
              {picked.prompt}
            </Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="claude">
            Recent tools
          </Text>
          {picked.log.length === 0 && <Text dimColor>None yet.</Text>}
          {picked.log.map(line => (
            <Text dimColor wrap="truncate-end">
              {`· ${line}`}
            </Text>
          ))}
        </Box>
        {picked.answer !== '' && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="claude">
              Reported
            </Text>
            <Text wrap="wrap">{picked.answer}</Text>
          </Box>
        )}
      </Box>
    )
  }
  const newest = [...data.agents].reverse()

  return (
    <Box flexDirection="column">
      {newest.length === 0 && <Text dimColor>No subagents yet. They show here as Claude starts them.</Text>}
      {newest.map(agent => {
        const design = designOf(agent.type)

        return (
          <Box flexDirection="column">
            <Button key={`agent:${agent.id}`} plain onPress={() => act.agent(agent.id)}>
              <Text color={design.color}>{design.glyph}</Text> {clip(agent.type, 20)}{' '}
              <Text dimColor>{oneLine(agent.description, Math.max(10, data.width - 28))}</Text>
            </Button>
            <Box paddingLeft={2}>
              <Text wrap="truncate-end" color={agent.status === 'failed' ? 'error' : agent.status === 'running' ? 'claude' : 'inactive'}>
                {stateOf(agent, data.now)}
                {agent.status === 'running' && agent.last !== '' ? ` · ${agent.last}` : ''}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function drawFiles(t: Kit, data: PaneData, act: PaneActions): RenderElement {
  const { Box, Text, Button } = t
  const rows = treeOf(data.files, data.root, false)
  const byId = new Map(data.agents.map(agent => [agent.id, agent]))

  return (
    <Box flexDirection="column">
      {rows.length === 0 && <Text dimColor>No files touched yet.</Text>}
      {rows.map(row => {
        if (row.kind === 'dir') {
          return (
            <Text bold wrap="truncate-start">
              {row.name}
            </Text>
          )
        }
        const op = markOf(row.file)
        const color = op === 'W' ? 'success' : op === 'E' ? 'warning' : 'inactive'
        const shown = relative(data.root, row.file.path)

        return (
          <Box flexDirection="row" columnGap={1} paddingLeft={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Button key={`file:${row.file.path}`} plain onPress={() => act.copy(shown)}>
                <Text color={color}>{op}</Text> {clip(row.name, Math.max(8, data.width - 16))}
                {row.file.isNew && <Text color="success"> new</Text>}
                {row.file.count > 1 && <Text dimColor>{` ×${row.file.count}`}</Text>}
                {row.file.agents.map(id => {
                  const design = designOf(byId.get(id)?.type ?? 'agent')

                  return <Text color={design.color}>{` ${design.glyph}`}</Text>
                })}
              </Button>
            </Box>
            <Button key={`open:${row.file.path}`} plain dimColor label="open" onPress={() => act.open(row.file.path)} />
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          W written · E edited · R read · a mark after a name is the subagent that touched it · enter copies the path
        </Text>
      </Box>
    </Box>
  )
}

function drawTasks(t: Kit, data: PaneData): RenderElement {
  const { Box, Text } = t
  const progress = progressOf(data.tasks)
  const bar = barOf(Math.max(8, Math.min(30, data.width - 14)), progress.percent)

  return (
    <Box flexDirection="column">
      {data.tasks.length === 0 ? (
        <Text dimColor>No task list yet. It fills in when Claude plans its work as tasks.</Text>
      ) : (
        <Text>
          <Text color="claude">{bar.full}</Text>
          <Text color="inactive">{bar.rest}</Text>
          {` ${progress.done}/${progress.total} ${progress.percent}%`}
        </Text>
      )}
      {data.tasks.map((task, index) => (
        <Text wrap="wrap" dimColor={task.status === 'completed'} bold={task.status === 'in_progress'}>
          {mark(t, task)}
          {` ${String(index + 1).padStart(2)} ${task.text}`}
        </Text>
      ))}
    </Box>
  )
}

export function drawPane(t: Kit, data: PaneData, act: PaneActions): RenderElement {
  const { Box, Text, Button } = t
  const { view, turn } = data
  const running = data.agents.filter(agent => agent.status === 'running').length
  const counts: Record<FlowView['tab'], string> = {
    agents: running > 0 ? ` ${running}` : '',
    files: data.files.length > 0 ? ` ${data.files.length}` : '',
    tasks: data.tasks.length > 0 ? ` ${progressOf(data.tasks).done}/${data.tasks.length}` : '',
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        {TABS.map(tab => (
          <Button key={`tab:${tab.id}`} plain label={`${tab.title}${counts[tab.id]}`} dimColor={view.tab !== tab.id} onPress={() => act.tab(tab.id)}>
            {view.tab === tab.id ? (
              <Text bold color="claude">
                {`${tab.title}${counts[tab.id]}`}
              </Text>
            ) : (
              `${tab.title}${counts[tab.id]}`
            )}
          </Button>
        ))}
        <Box flexGrow={1} />
        <Button key="clear" plain dimColor label="clear" onPress={() => act.clear()} />
      </Box>
      <Text dimColor wrap="truncate-end">
        {turn === null
          ? 'No turn yet.'
          : turn.isWorking
            ? `working · ${turn.tools} tools · ${turn.title}`
            : `last turn ${took(turn.endedAt - turn.startedAt)} · ${turn.tools} tools · ${turn.title}`}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {view.tab === 'agents' ? drawAgents(t, data, act) : view.tab === 'files' ? drawFiles(t, data, act) : drawTasks(t, data)}
      </Box>
    </Box>
  )
}
