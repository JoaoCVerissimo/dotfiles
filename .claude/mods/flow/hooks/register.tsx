// Flow: what Claude is doing, at a glance.
//
// A band above the prompt while a turn runs: the prompt it is on, a progress
// bar over the task list, the tasks by number with a mark that fills in as
// each is done, and the subagents at work. A pane (/flow) with three tabs:
// the subagents, each under a mark of its own with its recent tool calls and
// what it reported; the files touched, by folder; the whole task list.
//
// Everything is observed: tool calls (tasks, files, counts), agent spawns and
// turn ends. Nothing is asked of the model and nothing it sees is changed.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { FlowView } from '../types'
import { drawBand, drawPane } from './lib/draw'
import type { PaneActions } from './lib/draw'
import type { FileOp } from './lib/model'
import { agentChanged, agentStarted, describe, logged, oneLine, taskCreated, taskUpdated, tasksOfTodos, touched } from './lib/model'

const PANE = 'flow'
// The tool Claude posts its steps through, as the model names it.
const STEPS_TOOL = 'mcp__flow__steps'
const STEPS_DESCRIPTION =
  'Show the user your plan for the current request as a list of steps with a progress bar. ' +
  'Call it once you know the plan for work that takes several steps (3 to 8 short steps, a few words each), ' +
  'and again each time a step starts or finishes, always with the whole list. ' +
  'At most one step is in_progress. Do not call it for quick answers or single-step requests.'
const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      description: 'The whole plan, in order.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The step, in a few words.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['text', 'status'],
      },
    },
  },
  required: ['steps'],
}
const STEPS_SECTION =
  `For work that takes several steps, post your plan with the ${STEPS_TOOL} tool and update it as each step starts and finishes; the user follows it as a progress bar. Skip it for quick answers.`
// A prompt names the turn that follows it at once; later, a turn is the same job going on.
const TITLE_HOLDS_MS = 5000
const FILE_OPS: Readonly<Record<string, FileOp>> = { Read: 'R', Edit: 'E', Write: 'W', NotebookEdit: 'E' }

const turn = atom({ plugin: 'flow', key: 'turn' } as const, null)
const tasks = atom({ plugin: 'flow', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'flow', key: 'agents' } as const, [])
const files = atom({ plugin: 'flow', key: 'files' } as const, [])
const view = atom({ plugin: 'flow', key: 'view' } as const, { tab: 'agents', agent: null })
// The mods panel's switches for this session; absent when the panel is not loaded.
const switches = { plugin: 'mods', key: 'switches' } as const

// Whether Flow is on, as of the turn's start: a tool call does not ask again.
let isTracking = true
// Whether this session draws where the band and pane show: a terminal or the desktop app.
// Elsewhere (an editor's chat panel, a headless run) Flow stays out of the way.
let canDraw = false
let root = ''
let asked: { title: string; at: number } | null = null

type Loose = Record<string, unknown>

async function isOn($: EngineInterface, options: PluginOptions): Promise<boolean> {
  const here = (await read($, switches).catch(() => undefined))?.flow

  return canDraw && (here ?? options.enabled !== false)
}

async function openPane($: EngineInterface, tab: FlowView['tab'] | null): Promise<void> {
  const mine = (await $.ui.panes()).find(pane => pane.id === PANE)
  const current = await read($, view)
  if (mine !== undefined && mine.isShown && (tab === null || tab === current.tab)) {
    await $.ui.close({ id: PANE })

    return
  }
  if (tab !== null) {
    await update($, view, () => ({ tab, agent: null }))
  }
  await $.ui.open({ id: PANE, title: 'Flow', focus: true, columns: 52, rows: 16 })
}

function actionsOf($: EngineInterface): PaneActions {
  return {
    tab: tab => void update($, view, () => ({ tab, agent: null })),
    agent: id => void update($, view, old => ({ ...old, agent: id })),
    copy: path =>
      void $.ui.copy({ text: path }).then(
        copied => $.ui.toast(copied.isCopied ? `copied ${path}` : `could not copy: ${copied.reason}`),
        () => $.ui.toast('could not copy the path'),
      ),
    open: path =>
      void $.process.run(['open', path], { timeoutMs: 10_000 }).then(
        ran => (ran.exitCode === 0 ? undefined : $.ui.toast(`could not open ${path}`)),
        () => $.ui.toast(`could not open ${path}`),
      ),
    clear: () =>
      void (async () => {
        await update($, files, () => [])
        await update($, agents, list => list.filter(agent => agent.status === 'running'))
        await update($, tasks, list => (list.every(task => task.status === 'completed') ? [] : list))
      })(),
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    root = await $.session.root().catch(() => e.cwd)
    canDraw = e.surface === 'terminal' || e.surface === 'desktop'
    isTracking = await isOn($, options)
    if (options.steps !== false && canDraw) {
      await $.tool
        .register({ name: 'steps', description: STEPS_DESCRIPTION, inputSchema: STEPS_SCHEMA, isDeferred: false })
        .catch(error => $.ui.log(String(error), { to: 'debug' }))
    }
    await $.command
      .register({
        name: 'flow',
        description: 'Open the Flow pane: subagents, touched files, task list',
        argumentHint: '[agents|files|tasks]',
        immediate: true,
      })
      .catch(error => $.ui.log(String(error), { to: 'debug' }))

    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    await openPane($, word === 'agents' || word === 'files' || word === 'tasks' ? word : null)

    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'composer' || kind === 'bridge' || kind === 'sdk') {
      asked = { title: oneLine(e.text.split('\n').find(line => line.trim() !== '') ?? '', 80), at: await $.clock.now() }
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isTracking = await isOn($, options)
    if (isTracking) {
      root = await $.session.root().catch(() => root)
      const startedAt = await $.clock.now()
      const title = asked !== null && startedAt - asked.at < TITLE_HOLDS_MS ? asked.title : null
      asked = null
      const previous = await read($, turn)
      if (title === null && previous !== null) {
        // A turn nobody typed (a subagent reporting back): the job goes on.
        await update($, turn, old => (old === null ? old : { ...old, id: e.turnId, isWorking: true, endedAt: 0 }))
      } else {
        await update($, turn, () => ({ id: e.turnId, title: title ?? '', startedAt, endedAt: 0, tools: 0, failed: 0, isWorking: true }))
        // A finished list makes way for the next one.
        await update($, tasks, list => (list.length > 0 && list.every(task => task.status === 'completed') ? [] : list))
      }
    }

    return next(e)
  })

  // Claude's own step list: answered here, never run anywhere.
  on('tool.call', { tool: STEPS_TOOL }, async ($, e) => {
    if (e.agentId === undefined) {
      await update($, tasks, () => tasksOfTodos((e as unknown as Loose).steps))
    }

    return { result: 'Shown to the user.' }
  })

  on('tool.call', async ($, e, next) => {
    if (!isTracking || e.tool === STEPS_TOOL) {
      return next(e)
    }
    const input = e as unknown as Loose
    const agentId = e.agentId ?? ''
    const line = describe(e.tool, input, root)
    if (agentId === '') {
      await update($, turn, old => (old === null ? old : { ...old, tools: old.tools + 1 }))
    } else {
      await update($, agents, list => agentChanged(list, agentId, agent => logged(agent, line)))
    }

    const ran = await next(e)
    const hasFailed = ran.deny !== undefined || ran.isError === true
    if (hasFailed) {
      if (agentId === '') {
        await update($, turn, old => (old === null ? old : { ...old, failed: old.failed + 1 }))
      }

      return ran
    }
    const result = (typeof ran.result === 'object' && ran.result !== null ? ran.result : {}) as Loose
    if (e.tool === 'TodoWrite') {
      await update($, tasks, () => tasksOfTodos(input.todos))
    } else if (e.tool === 'TaskCreate') {
      const made = (typeof result.task === 'object' && result.task !== null ? result.task : {}) as Loose
      await update($, tasks, list =>
        taskCreated(list, String(made.id ?? ''), String(input.subject ?? ''), String(input.activeForm ?? '')),
      )
    } else if (e.tool === 'TaskUpdate') {
      await update($, tasks, list => taskUpdated(list, String(input.taskId ?? ''), input))
    }
    const op = FILE_OPS[e.tool]
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
    if (op !== undefined && path !== '') {
      const at = await $.clock.now()
      await update($, files, list => touched(list, path, op, agentId, at, e.tool === 'Write' && result.type === 'create'))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!isTracking || started.deny !== undefined || started.agentId === undefined) {
      return started
    }
    const startedAt = await $.clock.now()
    const id = started.agentId
    await update($, agents, list =>
      agentStarted(list, {
        id,
        type: e.subagentType,
        description: oneLine(e.description, 120),
        prompt: oneLine(e.prompt, 600),
        model: started.model,
        status: 'running',
        startedAt,
        endedAt: 0,
        tools: 0,
        tokens: 0,
        last: '',
        log: [],
        answer: '',
      }),
    )
    if (options.autoOpen === true) {
      void $.ui.open({ id: PANE, title: 'Flow', columns: 52, rows: 16 }).catch(() => undefined)
    }

    return started
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!isTracking) {
      return result
    }
    const endedAt = await $.clock.now()
    const agentId = e.agentId
    if (agentId === undefined) {
      await update($, turn, old => (old === null ? old : { ...old, isWorking: false, endedAt }))
    } else {
      const used = e.usage === undefined ? 0 : e.usage.input_tokens + e.usage.output_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens
      await update($, agents, list =>
        agentChanged(list, agentId, agent => ({
          ...agent,
          status: e.reason === 'answer' ? 'done' : 'failed',
          endedAt,
          tokens: used,
          answer: oneLine(e.answer, 1200),
        })),
      )
    }

    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (options.steps === false || !isTracking || e.traits.includes('teammate') || !e.tools.includes(STEPS_TOOL)) {
      return composed
    }

    return { sections: [...composed.sections, { id: 'flow:steps', text: STEPS_SECTION, scope: 'session' }] }
  })

  // The step list shows in the band; its calls would only be noise in the transcript.
  on('ui.render', { component: 'ToolUse', props: { tool: STEPS_TOOL } }, async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult', props: { tool: STEPS_TOOL } }, async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || options.band === 'off' || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return below
    }
    const current = await read($, turn)
    const crew = await read($, agents)
    const isBusy = current !== null && (current.isWorking || crew.some(agent => agent.status === 'running'))
    if (!isBusy || !(await isOn($, options))) {
      return below
    }
    const t = $.ui.resolve(e)
    const band = drawBand(
      t,
      {
        width: e.props.bodyColumns,
        turn: current,
        tasks: await read($, tasks),
        agents: crew,
        isCompact: options.band === 'compact',
        maxTasks: typeof options.maxTasks === 'number' ? options.maxTasks : 6,
      },
      () => void openPane($, null),
    )

    return (
      <t.Box flexDirection="column">
        {below}
        {band}
      </t.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }

    return drawPane(
      $.ui.resolve(e),
      {
        width: e.props.bodyColumns,
        view: await read($, view),
        turn: await read($, turn),
        tasks: await read($, tasks),
        agents: await read($, agents),
        files: await read($, files),
        root,
        now: await $.clock.now(),
      },
      actionsOf($),
    )
  })
}
