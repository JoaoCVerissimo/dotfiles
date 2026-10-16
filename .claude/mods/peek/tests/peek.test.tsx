import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock, Plugin } from 'claude-code/testing'

import { fitWidth, numbersIn, projectFolder, rasterOf, sizeOf } from '../hooks/lib/picture'

// The panel as Peek sees it: the switches it keeps for the session, flipped here by a command.
const PANEL: Plugin = {
  name: 'mods',
  register(on) {
    on('command.run', { command: 'flip' }, async ($, e) => {
      await $.state.set({ plugin: 'mods', key: 'switches' } as const, JSON.parse(e.args))

      return {}
    })
  },
}

const BAND = {
  plugin: 'peek',
  component: 'AbovePrompt',
  viewport: { columns: 150, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 140, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/shop' } as const
const IMAGES = '/tmp/claude-501/-work-shop/session-1/images'

// A picture as `sips` writes a BMP: 24 bits a pixel, rows from the bottom up, each padded to four bytes.
function bmp(width: number, height: number, colorAt: (x: number, y: number) => [number, number, number]): Uint8Array {
  const stride = Math.floor((24 * width + 31) / 32) * 4
  const bytes = new Uint8Array(54 + stride * height)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(10, 54, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(28, 24, true)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = colorAt(x, y)
      const at = 54 + (height - 1 - y) * stride + x * 3
      bytes[at] = blue
      bytes[at + 1] = green
      bytes[at + 2] = red
    }
  }

  return bytes
}

// A small picture: sky blue above, grass green below.
const SMALL = bmp(4, 4, (x, y) => (y < 2 ? [0, 0, 255] : [0, 255, 0]))

// A window the test's machine has shown: up until its own close button is pressed, or Peek leaves its script.
type Shown = { argv: string[]; isUp: boolean; close: () => void }

// Claude Code as Peek asks it: the prompt box, the session, the files, the commands it runs and the windows it opens.
function world(on: On, box: { text: string }, ran: string[][] = [], windows: Shown[] = []): MockClock {
  const clock = mock.clock(on)
  mock.env(on, { TMPDIR: '/tmp/t/' })
  on('session.start', () => ({ cwd: '/work/shop' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.root', () => ({ value: '/work/shop' }))
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('fs.exists', ($, e) => ({ value: e.path === IMAGES || e.path.startsWith(`${IMAGES}/`) }))
  // A paste is kept in the format it came in: the first as a PNG, the second as a JPEG.
  const kept = (name: string) => ({ name, kind: 'file', size: 900, mtimeMs: 0, isLink: false }) as const
  on('fs.list', ($, e) => ({ value: e.path === IMAGES ? [kept('1.png'), kept('2.jpg')] : [] }))
  on('fs.read', () => ({ value: { base64: SMALL.toBase64() } }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'id' ? '501\n' : e.argv.includes('pixelWidth') ? '  pixelWidth: 320\n  pixelHeight: 200\n' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e, next) {
    const shown: Shown = { argv: [...e.argv], isUp: true, close: () => undefined }
    windows.push(shown)
    await new Promise<void>(resolve => {
      shown.close = resolve
      next.signal.addEventListener('abort', () => resolve())
    })
    shown.isUp = false

    return { value: next.signal.aborted ? { code: null, signal: 'SIGTERM' } : { code: 0, signal: null } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['the engine\'s own band'] }))

  return clock
}

test('switched off, the prompt box is not read and nothing is drawn', { options: { enabled: false } }, async ($, on) => {
  const ran: string[][] = []
  const clock = world(on, { text: '[Image #1] what is this?' }, ran)
  await $.session.start(START)
  await clock.advance(3000)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'the engine\'s own band' })).toBeDefined()
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect(ran).toEqual([])
  await band.unmount()
})

test('on by default: an image in the prompt box is drawn above it, with its number and size', async ($, on) => {
  const ran: string[][] = []
  const box = { text: '' }
  const clock = world(on, box, ran)
  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(1000)
  expect(await band.find({ type: 'Raster' })).toBeUndefined()

  box.text = '[Image #1] is this the right chart?'
  await clock.advance(1000)
  const picture = await band.find({ type: 'Raster' })
  expect(picture?.props.columns).toBe(4)
  expect(picture?.props.rows).toBe(2)
  expect(await band.find({ type: 'Text', text: 'Image #1 · 320 × 200' })).toBeDefined()
  // What the engine and the mods beneath draw there stays, above the previews.
  expect(await band.find({ type: 'Text', text: 'the engine\'s own band' })).toBeDefined()
  // The picture is the one Claude Code kept for this session, shrunk to fit the preview's box.
  const shrink = ran.find(argv => argv[0] === 'sips' && argv.includes('--resampleWidth'))
  expect(shrink?.includes(`${IMAGES}/1.png`)).toBe(true)
  expect(shrink?.[shrink.indexOf('--resampleWidth') + 1]).toBe('32')

  // A second image joins it, found by its number whatever its format, and the first is not shrunk again.
  box.text = '[Image #1] and [Image #2]'
  await clock.advance(1000)
  expect((await band.findAll({ type: 'Raster' })).length).toBe(2)
  const shrinks = ran.filter(argv => argv.includes('--resampleWidth'))
  expect(shrinks.length).toBe(2)
  expect(shrinks[1]?.includes(`${IMAGES}/2.jpg`)).toBe(true)

  // An image whose file is not there yet has no preview, and is looked for again.
  box.text = '[Image #1] and [Image #2] and [Image #3]'
  await clock.advance(1000)
  expect((await band.findAll({ type: 'Raster' })).length).toBe(2)

  // Sent or deleted, the marks leave the box and the previews with them.
  box.text = ''
  await clock.advance(1000)
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'the engine\'s own band' })).toBeDefined()
  await band.unmount()
})

test('the panel\'s switch starts the watch and ends it', { plugins: [PANEL] }, async ($, on) => {
  const box = { text: '[Image #1]' }
  const clock = world(on, box)
  await $.session.start(START)
  const typed = (args: string) => ({ command: 'flip', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } }) as const
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await $.command.run(typed('{"peek":true}'))
  await clock.advance(1000)
  expect(await band.find({ type: 'Raster' })).toBeDefined()

  await $.command.run(typed('{"peek":false}'))
  await clock.advance(1000)
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  await band.unmount()
})

test('Open shows the picture itself in a window of its own, and Close takes it away', { options: { enabled: true } }, async ($, on) => {
  const windows: Shown[] = []
  const clock = world(on, { text: '[Image #1] and [Image #2]' }, [], windows)
  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(1000)
  expect((await band.find({ key: 'open:1' }))?.props.label).toBe('Open')
  expect((await band.find({ key: 'open:2' }))?.props.label).toBe('Open')
  expect(windows).toEqual([])

  // The window is a script of macOS's own, given the file Claude Code kept, a title and the picture's size.
  await band.press({ key: 'open:2' })
  await clock.settle()
  expect(windows.length).toBe(1)
  expect(windows[0]?.argv.slice(0, 4)).toEqual(['osascript', '-l', 'JavaScript', '-e'])
  expect(windows[0]?.argv[4]).toContain('NSImageView')
  expect(windows[0]?.argv.slice(5)).toEqual([`${IMAGES}/2.jpg`, 'Image #2 · 320 × 200', '320', '200'])
  expect(windows[0]?.isUp).toBe(true)
  // Its button now closes it; the other picture's still opens.
  expect((await band.find({ key: 'close:2' }))?.props.label).toBe('Close')
  expect(await band.find({ key: 'open:2' })).toBeUndefined()
  expect(await band.find({ key: 'open:1' })).toBeDefined()

  await band.press({ key: 'close:2' })
  await clock.settle()
  expect(windows[0]?.isUp).toBe(false)
  expect(await band.find({ key: 'open:2' })).toBeDefined()
  expect(await band.find({ key: 'close:2' })).toBeUndefined()
  await band.unmount()
})

test('one window at a time, and it goes when it is closed or its image leaves the prompt box', { options: { enabled: true } }, async ($, on) => {
  const windows: Shown[] = []
  const box = { text: '[Image #1] and [Image #2]' }
  const clock = world(on, box, [], windows)
  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(1000)

  // Another picture's window takes the first one's place.
  await band.press({ key: 'open:1' })
  await clock.settle()
  await band.press({ key: 'open:2' })
  await clock.settle()
  expect(windows.map(shown => shown.isUp)).toEqual([false, true])
  expect(await band.find({ key: 'open:1' })).toBeDefined()
  expect(await band.find({ key: 'close:2' })).toBeDefined()

  // Closed by its own close button, its button offers to open it again.
  windows[1]?.close()
  await clock.settle()
  expect(await band.find({ key: 'open:2' })).toBeDefined()
  expect(await band.find({ key: 'close:2' })).toBeUndefined()

  // Sent or deleted, an image takes its window with it; the other image's window stays.
  await band.press({ key: 'open:1' })
  await clock.settle()
  box.text = '[Image #1]'
  await clock.advance(1000)
  expect(windows[2]?.isUp).toBe(true)
  box.text = ''
  await clock.advance(1000)
  expect(windows[2]?.isUp).toBe(false)
  expect(windows.length).toBe(3)
  await band.unmount()
})

test('switching Peek off closes the window it had open', { plugins: [PANEL] }, async ($, on) => {
  const windows: Shown[] = []
  const clock = world(on, { text: '[Image #1]' }, [], windows)
  await $.session.start(START)
  const typed = (args: string) => ({ command: 'flip', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } }) as const
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.command.run(typed('{"peek":true}'))
  await clock.advance(1000)
  await band.press({ key: 'open:1' })
  await clock.settle()
  expect(windows[0]?.isUp).toBe(true)

  await $.command.run(typed('{"peek":false}'))
  await clock.advance(1000)
  expect(windows[0]?.isUp).toBe(false)
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  await band.unmount()
})

test('a new start of the session closes the window and offers Open again', { options: { enabled: true } }, async ($, on) => {
  const windows: Shown[] = []
  const clock = world(on, { text: '[Image #1]' }, [], windows)
  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(1000)
  await band.press({ key: 'open:1' })
  await clock.settle()
  expect(await band.find({ key: 'close:1' })).toBeDefined()

  // A reload of the mod raises session.start again: no window is left behind, and no Close button for one.
  await $.session.start(START)
  await clock.settle()
  expect(windows[0]?.isUp).toBe(false)
  expect(await band.find({ key: 'open:1' })).toBeDefined()
  expect(await band.find({ key: 'close:1' })).toBeUndefined()
  await band.unmount()
})

test('the marks in a draft are read in the order they stand, each once', () => {
  expect(numbersIn('')).toEqual([])
  expect(numbersIn('look at [Image #2] then [Image #1], and [Image #2] again')).toEqual([2, 1])
  expect(numbersIn('[Image 3] is not a mark')).toEqual([])
})

test('a picture is fitted to the preview\'s box and turned into half-block cells', () => {
  expect(sizeOf('/tmp/a.png\n  pixelWidth: 1920\n  pixelHeight: 1080\n')).toEqual({ width: 1920, height: 1080 })
  expect(sizeOf('Error: cannot read')).toBeNull()
  // Wide pictures are held by the width, tall ones by the height: two pixels a row.
  expect(fitWidth({ width: 320, height: 200 }, 36, 10)).toBe(32)
  expect(fitWidth({ width: 1920, height: 400 }, 36, 10)).toBe(36)
  expect(fitWidth({ width: 100, height: 1000 }, 36, 10)).toBe(2)
  expect(projectFolder('/Users/me/My Project_1')).toBe('-Users-me-My-Project-1')

  const drawn = rasterOf(SMALL, 36, 10)
  expect(drawn?.columns).toBe(4)
  expect(drawn?.rows).toBe(2)
  const cells = new Uint32Array(Uint8Array.fromBase64(drawn?.cells ?? '').buffer)
  // The first cell is an upper half block, blue over blue; the last row is green over green.
  expect([...cells.slice(0, 3)]).toEqual([0x2580, 0x0000ff, 0x0000ff])
  expect([...cells.slice(-3)]).toEqual([0x2580, 0x00ff00, 0x00ff00])
  expect(rasterOf(new Uint8Array([1, 2, 3]), 36, 10)).toBeNull()
})
