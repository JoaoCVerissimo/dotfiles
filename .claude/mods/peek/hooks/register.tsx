// Peek: a look at each image in the prompt box before it is sent.
//
// Claude Code shows a pasted image as `[Image #1]` and keeps the picture as
// a file in the session's temporary folder. While Peek is on it watches the
// prompt box for those marks, shrinks each picture with macOS's own `sips`,
// and draws it above the prompt as half-block cells, which any terminal with
// colors can show. Under each preview is an Open button, which shows the
// picture itself in a small window floating over the terminal.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { PeekShot } from '../types'
import { fitWidth, numbersIn, projectFolder, rasterOf, sizeOf } from './lib/picture'
import { WINDOW } from './lib/window'

// How often the prompt box is read while Peek is on, and how tall a preview may be.
const EVERY_MS = 700
const MAX_ROWS = 10

const shots = atom({ plugin: 'peek', key: 'shots' } as const, [])
// The number of the picture whose own window is open; null while none is.
const shown = atom({ plugin: 'peek', key: 'shown' } as const, null)
// The mods panel's switches for this session; absent when the panel is not loaded.
const switches = { plugin: 'mods', key: 'switches' } as const

// Where this session's pasted images are kept, once found; '' until then.
let images = ''
let tmp = '/tmp'
let isLooking = false
// The watch on the prompt box; null while Peek is off.
let timer: Timer | null = null
// The script behind the open window, whose loop is the window's life; null while none is open.
let viewer: { number: number; script: ReturnType<EngineInterface['process']['spawn']> } | null = null

async function isOn($: EngineInterface, options: PluginOptions): Promise<boolean> {
  return (await read($, switches).catch(() => undefined))?.peek ?? options.enabled === true
}

// Claude Code keeps a session's pasted images in
// /tmp/claude-<user id>/<project folder>/<session id>/images, numbered as the
// prompt box numbers them. The project folder is looked for by the session's
// id where the session's own path does not name it.
async function locate($: EngineInterface): Promise<string> {
  const uid = (await $.process.run(['id', '-u'], { timeoutMs: 5000 }).catch(() => null))?.stdout.trim() ?? ''
  const session = await $.session.id().catch(() => '')
  if (!/^\d+$/.test(uid) || session === '') {
    return ''
  }
  const base = `/tmp/claude-${uid}`
  const named = `${base}/${projectFolder(await $.session.root().catch(() => ''))}/${session}/images`
  if (await $.fs.exists(named).catch(() => false)) {
    return named
  }
  for (const entry of await $.fs.list(base).catch(() => [])) {
    const found = `${base}/${entry.name}/${session}/images`
    if (entry.kind === 'dir' && (await $.fs.exists(found).catch(() => false))) {
      return found
    }
  }

  return ''
}

// The file of one pasted image, '' while there is none. Claude Code keeps a
// paste in the format it came in, so image 2 may be 2.png, 2.jpg, 2.webp or 2.gif.
async function fileOf($: EngineInterface, number: number): Promise<string> {
  const kept = (await $.fs.list(images).catch(() => [])).find(entry => entry.kind === 'file' && entry.name.startsWith(`${number}.`))

  return kept === undefined ? '' : `${images}/${kept.name}`
}

// One picture, shrunk to the preview's box and turned into cells.
async function draw($: EngineInterface, options: PluginOptions, number: number): Promise<PeekShot | null> {
  if (images === '') {
    images = await locate($)
  }
  const picture = images === '' ? '' : await fileOf($, number)
  if (picture === '') {
    return null
  }
  const asked = typeof options.columns === 'number' ? options.columns : 36
  const columns = Math.max(8, Math.min(80, Math.round(asked)))
  const measured = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', picture], { timeoutMs: 10_000 }).catch(() => null)
  const size = measured === null ? null : sizeOf(measured.stdout)
  if (size === null) {
    return null
  }
  const small = `${tmp}/claude-peek-${number}.bmp`
  const shrunk = await $.process
    .run(['sips', '-s', 'format', 'bmp', '--resampleWidth', String(fitWidth(size, columns, MAX_ROWS)), picture, '--out', small], { timeoutMs: 10_000 })
    .catch(() => null)
  const bytes = shrunk === null || shrunk.exitCode !== 0 ? null : await $.fs.read(small, { as: 'bytes' }).catch(() => null)
  const raster = bytes === null ? null : rasterOf(Uint8Array.fromBase64(bytes.base64), columns, MAX_ROWS)

  return raster === null ? null : { number, file: picture, ...size, ...raster }
}

// Closes the picture's own window, if one is open.
async function shut($: EngineInterface): Promise<void> {
  const open = viewer
  viewer = null
  // leaving the script's stream ends the script, and its window with it
  void open?.script.return({ code: null, signal: null }).catch(() => undefined)
  if ((await read($, shown)) !== null) {
    await update($, shown, () => null)
  }
}

// Shows one picture itself, in a window that floats over the terminal: one
// window at a time, so another picture's takes its place.
async function show($: EngineInterface, shot: PeekShot): Promise<void> {
  await shut($)
  const title = `Image #${shot.number} · ${shot.width} × ${shot.height}`
  const script = $.process.spawn({ argv: ['osascript', '-l', 'JavaScript', '-e', WINDOW, shot.file, title, String(shot.width), String(shot.height)] })
  viewer = { number: shot.number, script }
  await update($, shown, () => shot.number)
  // The script runs for as long as its window is open, so it is not waited for.
  void (async () => {
    try {
      for await (const said of script) {
        void said
      }
    } catch {
      // the script could not start: there is no window
    }
    // closed by its own close button
    if (viewer?.script === script) {
      viewer = null
      await update($, shown, () => null).catch(() => undefined)
    }
  })()
}

// Reads the prompt box and keeps one preview for each image it names now.
async function look($: EngineInterface, options: PluginOptions): Promise<void> {
  if (isLooking) {
    return
  }
  isLooking = true
  try {
    const wanted = numbersIn((await $.prompt.read()).text)
    // Sent or deleted, a picture's own window goes with its mark.
    if (viewer !== null && !wanted.includes(viewer.number)) {
      await shut($)
    }
    const held = await read($, shots)
    if (wanted.length === held.length && wanted.every((number, at) => held[at]?.number === number)) {
      return
    }
    const next: PeekShot[] = []
    for (const number of wanted) {
      const shot = held.find(one => one.number === number) ?? (await draw($, options, number))
      if (shot !== null) {
        next.push(shot)
      }
    }
    await update($, shots, () => next)
  } finally {
    isLooking = false
  }
}

// Watches the prompt box while Peek is on, and lets go of it when it is off.
async function watch($: EngineInterface, options: PluginOptions): Promise<void> {
  const isWanted = await isOn($, options)
  if (isWanted && timer === null) {
    timer = $.clock.every(EVERY_MS, () => void look($, options).catch(() => undefined))
  }
  if (!isWanted && timer !== null) {
    timer.cancel()
    timer = null
    await shut($)
    await update($, shots, () => [])
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '') || '/tmp'
    // A reload ends a window with the module that opened it, and the session's state outlives both.
    await shut($)
    await watch($, options)

    return next(e)
  })

  // /clear, /resume and /branch move to another session, with images of its own.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    images = ''
    await shut($)
    await update($, shots, () => [])

    return next(e)
  })

  // The panel switched something for this session.
  on('state.set', { plugin: 'mods', key: 'switches' }, async ($, e, next) => {
    const result = await next(e)
    void watch($, options).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const held = (await isOn($, options)) ? await read($, shots) : []
    const t = $.ui.resolve(e)
    if (held.length === 0 || e.props.hasSurvey || e.surface !== 'terminal' || !('Raster' in t)) {
      return below
    }
    const open = await read($, shown)
    const { Box, Text, Raster, Button } = t

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {held.map(shot => (
            <Box key={`shot:${shot.number}`} flexDirection="column">
              <Raster key={`picture:${shot.number}`} columns={shot.columns} rows={shot.rows} cells={shot.cells} />
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>{`Image #${shot.number} · ${shot.width} × ${shot.height}`}</Text>
                {open === shot.number ? (
                  <Button key={`close:${shot.number}`} label="Close" onPress={() => void shut($).catch(() => undefined)} />
                ) : (
                  <Button key={`open:${shot.number}`} label="Open" onPress={() => void show($, shot).catch(() => undefined)} />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
