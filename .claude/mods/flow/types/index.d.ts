// What Flow keeps about a session: the running turn, the task list, the
// subagents and the files touched.

export type FlowTask = {
  id: string
  text: string
  activeForm: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type FlowTurn = {
  id: string
  title: string
  startedAt: number
  endedAt: number
  tools: number
  failed: number
  isWorking: boolean
}

export type FlowAgent = {
  id: string
  type: string
  description: string
  prompt: string
  model: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt: number
  tools: number
  tokens: number
  last: string
  log: string[]
  answer: string
}

export type FlowFile = {
  path: string
  ops: string
  count: number
  at: number
  agents: string[]
  isNew: boolean
}

export type FlowView = { tab: 'agents' | 'files' | 'tasks'; agent: string | null }

declare module 'claude-code' {
  interface PluginState {
    flow: {
      turn: FlowTurn | null
      tasks: FlowTask[]
      agents: FlowAgent[]
      files: FlowFile[]
      view: FlowView
    }
  }
}
