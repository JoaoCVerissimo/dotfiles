// What Look knows about the project this session runs in.

export type LookProject = {
  // the project's root, and the name of the theme file kept for it
  root: string
  slug: string
  // the skin picked for it; '' for none
  skin: string
  // whether this session started on the project's own theme, so a change of skin shows at once
  isLive: boolean
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    look: {
      project: LookProject
    }
  }
}
