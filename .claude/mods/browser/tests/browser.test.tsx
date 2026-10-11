import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { consoleLines, decode, normalizeUrl, rasterOf, toMarkdown } from '../hooks/lib/html'

const PAGE = `<!doctype html><html><head><title> Test &amp; shop </title><style>p{color:red}</style>
<script>console.log("<b>not text</b>")</script></head>
<body><h1>Shop</h1><nav><a href="/about.html">About us</a> <a href="https://example.com/x?a=1">Example</a> <a href="javascript:void(0)">Nope</a></nav>
<p>Prices &amp; offers&nbsp;below &#169; 2026.</p><ul><li>Apples <em>fresh</em></li><li>Pears</li></ul>
<form><input type="email" placeholder="you@example.com"><input type="hidden" name="csrf" value="s3cret"><button>Send</button></form>
<pre><code>npm run dev
  --port 3000</code></pre></body></html>`

const PANE = {
  plugin: 'browser',
  component: 'Pane',
  requestId: 'browser',
  viewport: { columns: 170, rows: 46 },
  props: { title: 'Browser', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// A machine with Chrome whose pages come from `pages`: the DOM dump lands in the file the mod reads back.
function world(on: On, pages: Record<string, string>): { ran: string[][] } {
  const files = new Map<string, string>()
  const ran: string[][] = []
  mock.clock(on)
  mock.env(on, { TMPDIR: '/tmp/t/' })
  on('session.start', () => ({ cwd: '/work/app' }))
  on('command.register', () => ({ value: { command: 'browser' } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', ($, e) => ({ value: e.path.includes('Google Chrome') }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const url = e.argv.at(-1) ?? ''
    const out = e.argv[4] ?? ''
    const err = e.argv[5] ?? ''
    files.set(out, pages[url] ?? '')
    files.set(err, '[1:2:1011/1.2:INFO:CONSOLE:3] "boom: cart failed", source: http://localhost:3000/app.js (3)\n')

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', ($, e) => {
    const text = files.get(e.path)

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('http.fetch', () => ({ value: { status: 404, ok: false, headers: {}, text: '' } }))
  on('prompt.fill', () => ({ isFilled: true, text: '', cursor: 0 }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))

  return { ran }
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work/app' } as const

test('a page loads through headless Chrome, links follow by number, and back returns', async ($, on) => {
  const { ran } = world(on, {
    'http://localhost:3000/': PAGE,
    'http://localhost:3000/about.html': '<html><head><title>About</title></head><body><h1>About us</h1><a href="/">Home</a></body></html>',
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'go', text: 'localhost:3000' })

  expect(await ui.find({ type: 'Text', text: 'Test & shop' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 links · via headless Chrome/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /boom: cart failed \(app\.js:3\)/ })).toBeDefined()
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('About us ‹1› Example ‹2› Nope')
  // The address rides as an argument after the watchdog's own, never inside its script.
  expect(ran[0]?.slice(0, 2)).toEqual(['/bin/sh', '-c'])
  expect(ran[0]?.at(-1)).toBe('http://localhost:3000/')

  await ui.input({ key: 'go', text: '1' })
  expect(await ui.find({ type: 'Text', text: 'About' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: 'Test & shop' })).toBeDefined()
  await ui.unmount()
})

test('handing a page to Claude sends its text once, marked as web content', async ($, on) => {
  world(on, { 'http://localhost:3000/': PAGE })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'go', text: 'localhost:3000' })
  await ui.press({ key: 'prompt' })

  const first = await $.prompt.submit({ text: 'why is the cart broken?', origin: { kind: 'composer' }, wait: false })
  expect('context' in first ? first.context?.join('\n') : '').toContain('<page_text_untrusted>')
  const second = await $.prompt.submit({ text: 'thanks', origin: { kind: 'composer' }, wait: false })
  expect('context' in second ? second.context : undefined).toBeUndefined()
  await ui.unmount()
})

test('a page becomes readable text with numbered links', () => {
  const page = toMarkdown(PAGE, 'http://localhost:3000/')

  expect(page.title).toBe('Test & shop')
  expect(page.links).toEqual(['http://localhost:3000/about.html', 'https://example.com/x?a=1'])
  expect(page.text).toContain('# Shop')
  expect(page.text).toContain('About us ‹1› Example ‹2› Nope')
  expect(page.text).toContain('Prices & offers below © 2026.')
  expect(page.text).toContain('- Apples _fresh_\n- Pears')
  expect(page.text).toContain('[email field: you@example.com]')
  expect(page.text).toContain('```\nnpm run dev\n  --port 3000\n```')
  // Scripts, styles and hidden fields are not page text.
  expect(page.text).not.toContain('not text')
  expect(page.text).not.toContain('color:red')
  expect(page.text).not.toContain('s3cret')
})

test('addresses are completed, and anything but http is refused', () => {
  expect(normalizeUrl('localhost:3000/app')).toBe('http://localhost:3000/app')
  expect(normalizeUrl('example.com')).toBe('https://example.com/')
  expect(normalizeUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
  expect(normalizeUrl('file:///etc/passwd')).toBeNull()
  expect(normalizeUrl('')).toBeNull()
  expect(decode('a &lt; b &#x41; &unknown;')).toBe('a < b A &unknown;')
})

test('console lines are read from both of Chrome\'s spellings', () => {
  const log = [
    '[1:2:1011/1.2:INFO:CONSOLE:12] "Uncaught TypeError: x is not a function", source: http://localhost:3000/static/app.js (12)',
    '[1:2:1011/1.3:INFO:CONSOLE(3)] "hello", source: http://localhost:3000/ (3)',
    '[1:2:1011/1.4:ERROR:gpu.cc:1] not a console line',
  ].join('\n')

  expect(consoleLines(log)).toEqual(['Uncaught TypeError: x is not a function (app.js:12)', 'hello (localhost:3000:3)'])
})

test('a bitmap becomes half-block cells, top row first', () => {
  // A 2x2 24-bit BMP, stored bottom-up: red and green above, blue and white below.
  const header = [0x42, 0x4d, 70, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 24, 0]
  const rest = new Array(24).fill(0)
  const bottom = [0xff, 0, 0, 0xff, 0xff, 0xff, 0, 0]
  const top = [0, 0, 0xff, 0, 0xff, 0, 0, 0]
  const raster = rasterOf(Uint8Array.from([...header, ...rest, ...bottom, ...top]), 80, 40)

  expect(raster?.columns).toBe(2)
  expect(raster?.rows).toBe(1)
  const cells = new Uint32Array(Uint8Array.fromBase64(raster?.cells ?? '').buffer)
  expect([...cells]).toEqual([0x2580, 0xff0000, 0x0000ff, 0x2580, 0x00ff00, 0xffffff])
  expect(rasterOf(Uint8Array.from([1, 2, 3]), 80, 40)).toBeNull()
})
