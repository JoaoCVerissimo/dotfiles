// Reflect: your corrections, kept as rules.
//
// When a prompt reads like a correction or a preference ("don't mock the
// database", "from now on use pnpm"), or starts with "remember:", Reflect
// words it as a one-line rule and offers it above the prompt. You decide:
// save it for this project (CLAUDE.local.md, yours alone), save it for every
// project (~/.claude/rules/learned.md), or skip it. Nothing is written until
// you press, and a saved rule is handed to Claude with your next prompt so
// this session follows it too.
//
// A prompt is only looked at when it is short, typed by you, free of
// anything secret-shaped and worded like a preference; then one small model
// call decides. The prompt's text is never stored.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { ReflectItem } from '../types'
import { JUDGE_SYSTEM, cleanRule, explicitRule, isCandidate, itemsOf, judgePrompt, parseVerdict, withItem, withRule } from './lib/rules'

const QUEUE_MAX = 5
const GLOBAL_PREFACE = '# What Claude has learned about how I work\n\nRules I saved from my own corrections with the reflect mod. Edit freely.\n\n'

const pending = atom({ plugin: 'reflect', key: 'pending' } as const, [])
const saved = atom({ plugin: 'reflect', key: 'saved' } as const, [])
// The mods panel's switches for this session; absent when the panel is not loaded.
const switches = { plugin: 'mods', key: 'switches' } as const

let root = ''
let configDir = ''
// Whether this session draws where the offer shows: a terminal or the desktop app.
let canDraw = false
const queue: string[] = []
let isJudging = false

async function isOn($: EngineInterface, options: PluginOptions): Promise<boolean> {
  return canDraw && ((await read($, switches).catch(() => undefined))?.reflect ?? options.enabled !== false)
}

async function held($: EngineInterface): Promise<ReflectItem[]> {
  return itemsOf(await $.store.get('items').catch(() => undefined))
}

async function show($: EngineInterface, items: readonly ReflectItem[]): Promise<void> {
  await update($, pending, () => items.filter(item => item.root === root))
}

async function offer($: EngineInterface, rule: string, scope: ReflectItem['scope']): Promise<void> {
  const item: ReflectItem = { id: crypto.randomUUID(), rule, scope, root, at: await $.clock.now() }
  const items = withItem(await held($), item)
  await $.store.set('items', items).catch(() => undefined)
  await show($, items)
}

async function settle($: EngineInterface, id: string): Promise<void> {
  // Read again right before writing: another session may have added a rule since.
  const items = (await held($)).filter(item => item.id !== id)
  await $.store.set('items', items).catch(() => undefined)
  await show($, items)
}

// One small model call per queued prompt, one at a time.
async function drain($: EngineInterface, options: PluginOptions): Promise<void> {
  if (isJudging) {
    return
  }
  isJudging = true
  try {
    while (queue.length > 0) {
      const prompt = queue.shift() ?? ''
      const messages = await $.session.messages().catch(() => [])
      const lastReply = Array.isArray(messages) ? ([...messages].reverse().find(message => message.role === 'assistant')?.text ?? '') : ''
      const reply = await $.model
        .complete({
          model: typeof options.model === 'string' && options.model !== '' ? options.model : 'haiku',
          system: JUDGE_SYSTEM,
          prompt: judgePrompt(root, lastReply, prompt),
          maxTokens: 200,
          timeoutMs: 20_000,
        })
        .catch(() => null)
      const verdict = reply !== null && reply.isAnswered ? parseVerdict(reply.text) : null
      if (verdict !== null) {
        await offer($, verdict.rule, verdict.scope)
      }
    }
  } finally {
    isJudging = false
  }
}

// CLAUDE.local.md is personal: where the project is a git repository that
// does not ignore it yet, it is listed in the repository's own exclude file.
async function keepOutOfGit($: EngineInterface, dir: string): Promise<void> {
  const ignored = await $.process.run(['git', '-C', dir, 'check-ignore', '-q', 'CLAUDE.local.md'], { timeoutMs: 5000 }).catch(() => null)
  if (ignored === null || ignored.exitCode !== 1) {
    return
  }
  const where = await $.process.run(['git', '-C', dir, 'rev-parse', '--git-path', 'info/exclude'], { timeoutMs: 5000 }).catch(() => null)
  const path = where === null || where.exitCode !== 0 ? '' : where.stdout.trim()
  if (path === '') {
    return
  }
  const full = path.startsWith('/') ? path : `${dir}/${path}`
  const text = await $.fs.read(full).catch(() => '')
  if (!text.split('\n').includes('CLAUDE.local.md')) {
    await $.fs.write(full, `${text.replace(/\s*$/, '')}\nCLAUDE.local.md\n`.replace(/^\n/, ''))
  }
}

async function save($: EngineInterface, item: ReflectItem, target: ReflectItem['scope']): Promise<void> {
  const path = target === 'global' ? `${configDir}/rules/learned.md` : `${item.root}/CLAUDE.local.md`
  try {
    const text = await $.fs.read(path).catch(() => '')
    const next = withRule(text, item.rule, target === 'global' ? GLOBAL_PREFACE : '')
    if (next !== null) {
      await $.fs.write(path, next)
    }
    if (target === 'project') {
      await keepOutOfGit($, item.root)
    }
    await settle($, item.id)
    await update($, saved, list => [...list, item.rule].slice(-20))
    $.ui.toast(next === null ? 'That rule was saved already.' : `Saved to ${target === 'global' ? '~/.claude/rules/learned.md' : 'CLAUDE.local.md'}.`)
  } catch (error) {
    $.ui.toast(`Could not save the rule: ${String(error).slice(0, 120)}`)
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    root = await $.session.root().catch(() => e.cwd)
    canDraw = e.surface === 'terminal' || e.surface === 'desktop'
    await show($, await held($))
    await $.command
      .register({
        name: 'reflect',
        description: 'List the rules waiting to be saved from your corrections',
        argumentHint: '[clear]',
        immediate: true,
      })
      .catch(error => $.ui.log(String(error), { to: 'debug' }))

    return next(e)
  })

  // /clear, /resume and /branch reset the state above and raise no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    root = await $.session.root().catch(() => root)
    await show($, await held($))

    return next(e)
  })

  on('command.run', { command: 'reflect' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'clear') {
      const kept = (await held($)).filter(item => item.root !== root)
      await $.store.set('items', kept).catch(() => undefined)
      await show($, kept)

      return { text: 'Dropped the rules waiting in this project.' }
    }
    const list = await read($, pending)
    if (list.length === 0) {
      return { text: 'No rules are waiting. Correct Claude, or start a prompt with "remember:", and one shows above the prompt.' }
    }

    return { text: `${list.length} waiting:\n${list.map((item, index) => `${index + 1}. ${item.rule} (${item.scope})`).join('\n')}` }
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if ((kind !== 'composer' && kind !== 'bridge') || e.text.trimStart().startsWith('/') || !(await isOn($, options))) {
      return next(e)
    }
    // Only cheap checks here: the prompt goes on at once, the wording runs after it.
    const told = explicitRule(e.text)
    if (told !== null) {
      const rule = cleanRule(told)
      if (rule !== null) {
        $.clock.after(0, () => void offer($, rule, 'global').catch(() => undefined))
      }
    } else if (options.detect !== 'explicit' && isCandidate(e.text) && queue.length < QUEUE_MAX) {
      queue.push(e.text)
      $.clock.after(0, () => void drain($, options).catch(() => undefined))
    }
    // Rules saved since the last prompt reach Claude with this one; the files are only read at a session's start.
    const fresh = await read($, saved)
    if (fresh.length === 0) {
      return next(e)
    }
    await update($, saved, () => [])
    const note = `The user has just saved these rules for future work. Follow them from now on:\n${fresh.map(rule => `- ${rule}`).join('\n')}`

    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || e.props.isWorking || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return below
    }
    const list = await read($, pending)
    const item = list[0]
    if (item === undefined || !(await isOn($, options))) {
      return below
    }
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" paddingRight={5}>
          <Text wrap="truncate-end">
            <Text color="claude">◆</Text> <Text dimColor>reflect</Text> {`“${item.rule}”`}
            {list.length > 1 && <Text dimColor>{` +${list.length - 1} more`}</Text>}
          </Text>
          <Box flexDirection="row" columnGap={2} paddingLeft={2}>
            <Button key="reflect:project" plain hotkey="7" label="save for this project" onPress={() => void save($, item, 'project')} />
            <Button key="reflect:global" plain hotkey="8" label="save everywhere" onPress={() => void save($, item, 'global')} />
            <Button key="reflect:skip" plain hotkey="9" dimColor label="skip" onPress={() => void settle($, item.id)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
