import type { ModsSessionRow } from '../../types'

type Loose = Record<string, unknown>

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isLoose(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

// `ps -o pid=,tty=` lines: "30608 ttys000". A session with no terminal of
// its own (an editor's, the desktop app's) reads "??".
export function parseTtys(stdout: string): Record<string, string> {
  const ttys: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const [pid, tty] = line.trim().split(/\s+/)
    if (pid !== undefined && tty !== undefined && tty !== '??' && /^\d+$/.test(pid)) {
      ttys[pid] = tty.startsWith('/dev/') ? tty : `/dev/${tty}`
    }
  }

  return ttys
}

// `grep -H -o` lines over transcript files: "<path>:"aiTitle":"Fix the build"".
// The last title a file names wins; a custom title beats a generated one.
export function parseTitles(stdout: string): Record<string, string> {
  const titles: Record<string, string> = {}
  const ranks: Record<string, number> = {}
  for (const line of stdout.split('\n')) {
    const match = /^(.*?\.jsonl):"(customTitle|aiTitle|lastPrompt)":"((?:[^"\\]|\\.)*)"$/.exec(line)
    if (match === null) {
      continue
    }
    const [, path, kind, body] = match
    if (path === undefined || kind === undefined || body === undefined) {
      continue
    }
    const id = path.slice(path.lastIndexOf('/') + 1, -'.jsonl'.length)
    const rank = kind === 'customTitle' ? 3 : kind === 'aiTitle' ? 2 : 1
    if (rank >= (ranks[id] ?? 0)) {
      const parsed = parseJson(`"${body}"`)
      titles[id] = typeof parsed === 'string' ? parsed.replace(/\s+/g, ' ').trim() : body
      ranks[id] = rank
    }
  }

  return titles
}

export type Past = { sessionId: string; at: number; title: string; cwd: string }

export type RosterInput = {
  agents: unknown
  records: Readonly<Record<string, unknown>>
  ttys: Readonly<Record<string, string>>
  past: readonly Past[]
  selfId: string
}

// Every session worth listing, live ones first, each group by the last time
// it was touched.
export function buildRoster(input: RosterInput): ModsSessionRow[] {
  const rows: ModsSessionRow[] = []
  const seen = new Set<string>()
  const agents = Array.isArray(input.agents) ? input.agents : []
  for (const entry of agents) {
    if (!isLoose(entry)) {
      continue
    }
    const pid = count(entry.pid)
    const record = input.records[String(pid)]
    const more = isLoose(record) ? record : {}
    const sessionId = text(entry.sessionId) || text(more.sessionId)
    const jobId = text(entry.id)
    const state = text(entry.state)
    const status = text(entry.status) || state || 'idle'
    const isLive = pid > 0
    const key = sessionId || jobId || `pid:${pid}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    rows.push({
      key,
      sessionId,
      pid,
      name: text(entry.name) || text(more.name) || jobId || 'session',
      cwd: text(entry.cwd),
      kind: text(entry.kind) || 'interactive',
      status,
      waitingFor: text(entry.waitingFor),
      jobId,
      tty: input.ttys[String(pid)] ?? '',
      entrypoint: text(more.entrypoint),
      at: Math.max(count(more.statusUpdatedAt), count(more.updatedAt), count(entry.startedAt)),
      isLive,
      isSelf: sessionId !== '' && sessionId === input.selfId,
    })
  }
  for (const old of input.past) {
    if (seen.has(old.sessionId)) {
      continue
    }
    seen.add(old.sessionId)
    rows.push({
      key: old.sessionId,
      sessionId: old.sessionId,
      pid: 0,
      name: old.title || old.sessionId.slice(0, 8),
      cwd: old.cwd,
      kind: 'past',
      status: 'past',
      waitingFor: '',
      jobId: '',
      tty: '',
      entrypoint: '',
      at: old.at,
      isLive: false,
      isSelf: old.sessionId === input.selfId,
    })
  }

  return rows.sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.at - a.at)
}

// The folder Claude Code keeps a directory's transcripts in: the path with
// every character that is not a letter or a digit turned into a dash.
export function projectFolder(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

// What opening a row does, decided from what the row is.
export type Opening =
  | { kind: 'self' }
  | { kind: 'terminal'; tty: string }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'elsewhere'; where: string }

export function openingOf(row: ModsSessionRow): Opening {
  if (row.isSelf) {
    return { kind: 'self' }
  }
  if (row.isLive && row.kind !== 'background') {
    return row.tty === '' ? { kind: 'elsewhere', where: row.entrypoint || 'another app' } : { kind: 'terminal', tty: row.tty }
  }

  return row.sessionId === '' ? { kind: 'elsewhere', where: 'agent view' } : { kind: 'resume', sessionId: row.sessionId }
}

// AppleScript, one line per `-e`, that brings the terminal tab on a tty to
// the front. The tty rides as an argument, never as script text.
export function focusScript(program: string): string[] | null {
  if (program === 'Apple_Terminal') {
    return [
      'on run argv',
      'set target to item 1 of argv',
      'tell application "Terminal"',
      'repeat with w in windows',
      'repeat with t in tabs of w',
      'if tty of t is target then',
      'set selected of t to true',
      'set index of w to 1',
      'activate',
      'return "ok"',
      'end if',
      'end repeat',
      'end repeat',
      'end tell',
      'return "missing"',
      'end run',
    ]
  }
  if (program === 'iTerm.app') {
    return [
      'on run argv',
      'set target to item 1 of argv',
      'tell application "iTerm2"',
      'repeat with w in windows',
      'repeat with t in tabs of w',
      'repeat with s in sessions of t',
      'if tty of s is target then',
      'select w',
      'select t',
      'select s',
      'activate',
      'return "ok"',
      'end if',
      'end repeat',
      'end repeat',
      'end repeat',
      'end tell',
      'return "missing"',
      'end run',
    ]
  }

  return null
}
