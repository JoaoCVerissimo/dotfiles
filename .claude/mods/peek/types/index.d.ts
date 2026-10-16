// What Peek holds for the session: the pictures the prompt box names now,
// and which of them has its own window open.

export type PeekShot = {
  // the picture's number in the prompt box: 1 for `[Image #1]`
  number: number
  // the file Claude Code keeps it in
  file: string
  // its own size, in pixels
  width: number
  height: number
  // its preview: half-block cells for a Raster of `columns` by `rows`
  columns: number
  rows: number
  cells: string
}

declare module 'claude-code' {
  interface PluginState {
    peek: {
      shots: PeekShot[]
      // the number of the picture whose window is open; null while none is
      shown: number | null
    }
  }
}
