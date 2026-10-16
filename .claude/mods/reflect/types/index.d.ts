// A rule Reflect drew from something you said, waiting for your decision.
export type ReflectItem = {
  id: string
  rule: string
  // where the judge thought it belongs: this project, or every project
  scope: 'project' | 'global'
  root: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    reflect: {
      // the rules waiting in this session's project, oldest first
      pending: ReflectItem[]
      // the rules saved in this session: Claude is told them until the files are read again
      saved: string[]
    }
  }
}
