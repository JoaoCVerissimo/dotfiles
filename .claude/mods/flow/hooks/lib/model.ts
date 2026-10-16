import type { FlowAgent, FlowFile, FlowTask } from '../../types'

type Loose = Record<string, unknown>

const FILES_KEPT = 300
const AGENTS_KEPT = 40
const LOG_KEPT = 12

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function clip(value: string, max: number): string {
  const points = [...value]

  return points.length <= max ? value : `${points.slice(0, Math.max(0, max - 1)).join('')}…`
}

export function oneLine(value: string, max: number): string {
  return clip(value.replace(/\s+/g, ' ').trim(), max)
}

export function took(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)

  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function tokens(count: number): string {
  if (count < 1000) {
    return String(count)
  }

  return count < 1_000_000 ? `${Math.round(count / 1000)}k` : `${(count / 1_000_000).toFixed(1)}M`
}

// A path as the pane shows it: under the project root when it is there.
export function relative(root: string, path: string): string {
  if (root !== '' && path.startsWith(`${root}/`)) {
    return path.slice(root.length + 1)
  }

  return path
}

// What a tool call is doing, in a few words: the tool and what it is aimed at.
export function describe(tool: string, input: Loose, root: string): string {
  const path = text(input.file_path) || text(input.notebook_path) || text(input.path)
  if (path !== '') {
    return `${tool} ${relative(root, path)}`
  }
  const aim =
    text(input.command) || text(input.pattern) || text(input.query) || text(input.url) || text(input.description) || text(input.subject) || text(input.skill)

  return aim === '' ? tool : `${tool} ${oneLine(aim, 60)}`
}

// ---- tasks -----------------------------------------------------------------

function statusOf(value: unknown): FlowTask['status'] | undefined {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : undefined
}

export function tasksOfTodos(todos: unknown): FlowTask[] {
  if (!Array.isArray(todos)) {
    return []
  }

  return todos.flatMap((todo, index) => {
    if (typeof todo !== 'object' || todo === null) {
      return []
    }
    const one = todo as Loose

    return [
      {
        id: String(index + 1),
        text: oneLine(text(one.content) || text(one.text), 200),
        activeForm: oneLine(text(one.activeForm), 200),
        status: statusOf(one.status) ?? 'pending',
      },
    ]
  })
}

export function taskCreated(tasks: readonly FlowTask[], id: string, subject: string, activeForm: string): FlowTask[] {
  if (id === '' || tasks.some(task => task.id === id)) {
    return [...tasks]
  }

  return [...tasks, { id, text: oneLine(subject, 200), activeForm: oneLine(activeForm, 200), status: 'pending' }]
}

export function taskUpdated(tasks: readonly FlowTask[], id: string, change: Loose): FlowTask[] {
  if (change.status === 'deleted') {
    return tasks.filter(task => task.id !== id)
  }

  return tasks.map(task =>
    task.id !== id
      ? task
      : {
          ...task,
          status: statusOf(change.status) ?? task.status,
          text: text(change.subject) === '' ? task.text : oneLine(text(change.subject), 200),
          activeForm: text(change.activeForm) === '' ? task.activeForm : oneLine(text(change.activeForm), 200),
        },
  )
}

export type Progress = { done: number; total: number; percent: number; current: number }

export function progressOf(tasks: readonly FlowTask[]): Progress {
  const total = tasks.length
  const done = tasks.filter(task => task.status === 'completed').length
  const current = tasks.findIndex(task => task.status === 'in_progress')

  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), current }
}

// The tasks the band has room for: a window that keeps the one in progress in view.
export function windowOf(tasks: readonly FlowTask[], room: number): { from: number; shown: FlowTask[]; hidden: number } {
  if (tasks.length <= room) {
    return { from: 0, shown: [...tasks], hidden: 0 }
  }
  const { current, done } = progressOf(tasks)
  const anchor = current >= 0 ? current : Math.min(done, tasks.length - 1)
  const from = Math.max(0, Math.min(anchor - 1, tasks.length - room))

  return { from, shown: tasks.slice(from, from + room), hidden: tasks.length - room }
}

export function barOf(width: number, percent: number): { full: string; rest: string } {
  const cells = Math.max(0, Math.min(width, Math.round((width * percent) / 100)))

  return { full: '█'.repeat(cells), rest: '░'.repeat(width - cells) }
}

// ---- files -----------------------------------------------------------------

export type FileOp = 'R' | 'E' | 'W'

export function touched(files: readonly FlowFile[], path: string, op: FileOp, agent: string, at: number, isNew: boolean): FlowFile[] {
  const found = files.find(file => file.path === path)
  const next: FlowFile =
    found === undefined
      ? { path, ops: op, count: 1, at, agents: agent === '' ? [] : [agent], isNew }
      : {
          ...found,
          ops: found.ops.includes(op) ? found.ops : `${found.ops}${op}`,
          count: found.count + 1,
          at,
          agents: agent === '' || found.agents.includes(agent) ? found.agents : [...found.agents, agent].slice(-6),
          isNew: found.isNew || isNew,
        }
  const rest = files.filter(file => file.path !== path)

  return [...rest, next].slice(-FILES_KEPT)
}

// The strongest thing done to a file: written beats edited beats read.
export function markOf(file: FlowFile): FileOp {
  return file.ops.includes('W') ? 'W' : file.ops.includes('E') ? 'E' : 'R'
}

export type TreeRow = { kind: 'dir'; name: string } | { kind: 'file'; name: string; file: FlowFile }

// The touched files grouped under their folders, folders and files by name.
export function treeOf(files: readonly FlowFile[], root: string, isWritesOnly: boolean): TreeRow[] {
  const groups = new Map<string, Array<{ name: string; file: FlowFile }>>()
  for (const file of files) {
    if (isWritesOnly && markOf(file) === 'R') {
      continue
    }
    const shown = relative(root, file.path)
    const cut = shown.lastIndexOf('/')
    const dir = cut < 0 ? './' : `${shown.slice(0, cut)}/`
    const group = groups.get(dir) ?? []
    group.push({ name: shown.slice(cut + 1), file })
    groups.set(dir, group)
  }
  const rows: TreeRow[] = []
  for (const dir of [...groups.keys()].sort()) {
    rows.push({ kind: 'dir', name: dir })
    const group = groups.get(dir) ?? []
    for (const entry of group.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ kind: 'file', name: entry.name, file: entry.file })
    }
  }

  return rows
}

// ---- agents ----------------------------------------------------------------

export type Design = { glyph: string; color: string }

const DESIGNS: Readonly<Record<string, Design>> = {
  main: { glyph: '◆', color: 'claude' },
  Explore: { glyph: '◈', color: 'cyan' },
  Plan: { glyph: '▲', color: 'blue' },
  'general-purpose': { glyph: '●', color: 'yellow' },
  claude: { glyph: '✦', color: 'magenta' },
  fork: { glyph: '⑂', color: 'green' },
  teammate: { glyph: '☻', color: '#ff9f43' },
  'claude-code-guide': { glyph: '✚', color: '#a29bfe' },
  'statusline-setup': { glyph: '▬', color: '#55efc4' },
}
const SPARE_GLYPHS = ['■', '◉', '❖', '✿', '⬟', '⬢', '◭', '✪']
const SPARE_COLORS = ['#fd79a8', '#74b9ff', '#ffeaa7', '#81ecec', '#fab1a0', '#b2bec3', '#e17055', '#00cec9']

// The mark an agent type is known by, in the band and the pane: fixed for
// the built-in types, picked from the name for any other, so it stays the same.
export function designOf(type: string): Design {
  const known = DESIGNS[type]
  if (known !== undefined) {
    return known
  }
  let hash = 0
  for (const char of type) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }

  return {
    glyph: SPARE_GLYPHS[hash % SPARE_GLYPHS.length] ?? '■',
    color: SPARE_COLORS[(hash >>> 3) % SPARE_COLORS.length] ?? 'cyan',
  }
}

export function agentStarted(agents: readonly FlowAgent[], agent: FlowAgent): FlowAgent[] {
  return [...agents.filter(one => one.id !== agent.id), agent].slice(-AGENTS_KEPT)
}

export function agentChanged(agents: readonly FlowAgent[], id: string, change: (agent: FlowAgent) => FlowAgent): FlowAgent[] {
  return agents.map(agent => (agent.id === id ? change(agent) : agent))
}

export function logged(agent: FlowAgent, line: string): FlowAgent {
  return { ...agent, tools: agent.tools + 1, last: line, log: [...agent.log, line].slice(-LOG_KEPT) }
}
