// A web page's HTML as markdown a terminal can show: headings, lists, links
// numbered so a keyboard can follow them, code, and what forms are on it.
// No DOM here, so this is a tolerant scan over tags and text, not a parser.

const TEXT_MAX = 40_000
const LINKS_MAX = 200

const SKIPPED = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas'])
const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'form', 'table', 'ul', 'ol', 'blockquote',
  'figure', 'details', 'summary', 'dl', 'dt', 'dd', 'fieldset', 'address', 'figcaption',
])
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•', middot: '·', times: '×', rarr: '→', larr: '←',
}
const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g

export type Page = { title: string; text: string; links: string[] }

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)

      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }

    return ENTITIES[name] ?? whole
  })
}

function attribute(attributes: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attributes)

  return decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

// An address as typed, made whole: a scheme where there is none, https
// unless the host is this machine.
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (text === '') {
    return null
  }
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(text)
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) ? text : `${isLocal ? 'http' : 'https'}://${text}`
  if (!URL.canParse(withScheme)) {
    return null
  }
  const url = new URL(withScheme)

  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}

function resolve(href: string, base: string): string | null {
  if (href === '' || href.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(href) || !URL.canParse(href, base)) {
    return null
  }
  const url = new URL(href, base)

  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}

export function toMarkdown(html: string, base: string): Page {
  const out: string[] = []
  const links: string[] = []
  let title = ''
  let skipping = ''
  let isInTitle = false
  let isInPre = false
  let listDepth = 0
  let link: { url: string | null; text: string } | null = null

  const push = (piece: string): void => {
    if (link !== null) {
      link.text += piece
    } else {
      out.push(piece)
    }
  }

  for (const match of html.matchAll(TOKEN)) {
    const [whole, closing, rawName, attributes = '', text] = match
    if (rawName === undefined) {
      if (text === undefined || skipping !== '') {
        continue
      }
      const decoded = decode(text)
      if (isInTitle) {
        title += decoded
      } else {
        push(isInPre ? decoded : decoded.replace(/\s+/g, ' '))
      }
      continue
    }
    const name = rawName.toLowerCase()
    const isClose = closing === '/'
    if (skipping !== '') {
      if (isClose && name === skipping) {
        skipping = ''
      }
      continue
    }
    if (name === 'title') {
      isInTitle = !isClose
      continue
    }
    if (SKIPPED.has(name)) {
      if (!isClose && !whole.endsWith('/>')) {
        skipping = name
      }
      continue
    }
    if (/^h[1-6]$/.test(name)) {
      push(isClose ? '\n\n' : `\n\n${'#'.repeat(Number(name[1]))} `)
    } else if (name === 'ul' || name === 'ol') {
      listDepth = Math.max(0, listDepth + (isClose ? -1 : 1))
      push('\n')
    } else if (name === 'li') {
      if (!isClose) {
        push(`\n${'  '.repeat(Math.max(0, listDepth - 1))}- `)
      }
    } else if (BLOCKS.has(name)) {
      push('\n\n')
    } else if (name === 'br') {
      push('\n')
    } else if (name === 'hr') {
      push('\n\n---\n\n')
    } else if (name === 'tr') {
      push('\n')
    } else if (name === 'td' || name === 'th') {
      if (isClose) {
        push(' | ')
      }
    } else if (name === 'a') {
      if (!isClose) {
        if (link === null) {
          link = { url: resolve(attribute(attributes, 'href'), base), text: '' }
        }
      } else if (link !== null) {
        const done = link
        link = null
        const label = done.text.replace(/\s+/g, ' ').trim().replace(/[[\]]/g, '')
        if (done.url === null || label === '' || links.length >= LINKS_MAX) {
          push(label)
        } else {
          const known = links.indexOf(done.url)
          const index = known >= 0 ? known : links.push(done.url) - 1
          push(`${label} ‹${index + 1}›`)
        }
      }
    } else if (name === 'img') {
      const alt = attribute(attributes, 'alt')
      if (alt !== '') {
        push(`[image: ${alt}]`)
      }
    } else if (name === 'strong' || name === 'b') {
      push('**')
    } else if (name === 'em' || name === 'i') {
      push('_')
    } else if (name === 'pre') {
      isInPre = !isClose
      push(isClose ? '\n```\n\n' : '\n\n```\n')
    } else if (name === 'code') {
      if (!isInPre) {
        push('`')
      }
    } else if (name === 'input' && !isClose) {
      const kind = attribute(attributes, 'type') || 'text'
      if (kind !== 'hidden') {
        const hint = attribute(attributes, 'placeholder') || attribute(attributes, 'name') || attribute(attributes, 'value')
        push(` [${kind} field${hint === '' ? '' : `: ${hint}`}] `)
      }
    } else if (name === 'button') {
      push(isClose ? ' ] ' : ' [ ')
    } else if (name === 'textarea' || name === 'select') {
      if (!isClose) {
        push(` [${name}${attribute(attributes, 'name') === '' ? '' : `: ${attribute(attributes, 'name')}`}] `)
      }
    }
  }

  // Runs of spaces fold to one outside code, where they are layout; a fenced block keeps its own.
  let isFenced = false
  const text = out
    .join('')
    .split('\n')
    .map(line => {
      if (line.startsWith('```')) {
        isFenced = !isFenced

        return line
      }

      return isFenced ? line.replace(/\s+$/, '') : line.replace(/[ \t]+/g, ' ').replace(/\s+$/, '')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n\n… the page goes on (${text.length - TEXT_MAX} more characters)` : text,
    links,
  }
}

// What a page logged to the console while it loaded, read from Chrome's own log lines:
//   [1234:5678:1011/114500.123:INFO:CONSOLE:12] "Uncaught TypeError: x", source: http://localhost/app.js (12)
// Chrome logs every console call at one level, so a line says what was logged, not how.
export function consoleLines(stderr: string): string[] {
  const lines: string[] = []
  for (const line of stderr.split('\n')) {
    const match = /:CONSOLE[:(](\d+)\)?\]\s*"(.*)", source: (.*?)(?: \(\d+\))?$/.exec(line.trim())
    if (match === null) {
      continue
    }
    const [, at, message, source] = match
    const file = source === undefined || source === '' ? '' : (source.split('/').filter(part => part !== '').at(-1) ?? source)
    lines.push(`${(message ?? '').slice(0, 300)}${file === '' ? '' : ` (${file}:${at})`}`)
    if (lines.length >= 40) {
      break
    }
  }

  return lines
}

// A BMP picture as half-block cells for a Raster: each cell is the upper
// half block, its color the pixel above and its background the pixel below.
export function rasterOf(bytes: Uint8Array, maxColumns: number, maxRows: number): { columns: number; rows: number; cells: string } | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const rawHeight = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  if ((bits !== 24 && bits !== 32) || width <= 0 || rawHeight === 0) {
    return null
  }
  const height = Math.abs(rawHeight)
  const stride = Math.floor((bits * width + 31) / 32) * 4
  if (offset + stride * height > bytes.length) {
    return null
  }
  const pixel = (x: number, y: number): number => {
    const row = rawHeight < 0 ? y : height - 1 - y
    const at = offset + row * stride + x * (bits / 8)

    return ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at] ?? 0)
  }
  const columns = Math.min(width, maxColumns, 512)
  const rows = Math.min(Math.floor(height / 2), maxRows, 256)
  if (columns < 1 || rows < 1) {
    return null
  }
  const cells = new Uint32Array(columns * rows * 3)
  let at = 0
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      cells[at] = 0x2580
      cells[at + 1] = pixel(x, y * 2)
      cells[at + 2] = pixel(x, y * 2 + 1)
      at += 3
    }
  }

  return { columns, rows, cells: new Uint8Array(cells.buffer).toBase64() }
}
