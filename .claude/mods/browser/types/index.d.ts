// The page the Browser pane shows.

export type BrowserPage = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  url: string
  title: string
  // the page as markdown, links numbered ‹n›
  text: string
  links: string[]
  console: string[]
  error: string
  // how the page was loaded: headless Chrome, or a plain fetch where there is none
  via: string
}

export type BrowserShot = { url: string; columns: number; rows: number; cells: string } | null

export type BrowserView = { mode: 'text' | 'preview'; history: string[]; isAttached: boolean }

declare module 'claude-code' {
  interface PluginState {
    browser: {
      page: BrowserPage
      shot: BrowserShot
      view: BrowserView
    }
  }
}
