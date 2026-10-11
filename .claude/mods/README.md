# Claude Code mods

Six [mods](https://code.claude.com/docs/en/plugins/mods/overview) of my own, plus three of Anthropic's installed as they ship,
all switched from one panel. They are read straight from this folder, so an edit here is live after `/reload-plugins`.

```sh
scripts/claude-mods.sh     # from the repo root: registers this folder and installs everything (idempotent)
.claude/mods/check.sh      # validates and tests every mod
```

Needs Claude Code 2.1.296 or later, in a terminal (the fullscreen renderer docks panes as a sidebar from 110 columns).

## The panel

`/mods`, or the `◆ mods · control · sessions` buttons on the hint line under the prompt. Esc hands the keys back to the prompt.

| Tab | What it does |
| --- | --- |
| **Mods** | One row per mod. Its letter switches it **for this session**; `›` opens its page with the **always** switch (every session) and its settings. Always-switches and settings are Claude Code's own plugin options, so they land in `settings.json` (`pluginConfigs`). Anthropic's mods switch whole, for every session. |
| **Control** | Model and effort (run `/model`, `/effort`), plan mode, **ask before changes** (the real permission prompt for every edit, command and fetch in this session, whatever mode it is in), **stop this turn**, and `/focus`, `/fast`, `/context`, `/usage`, `/recap`, `/compact`, `/clear`, rename. |
| **Sessions** | Every session on this machine, live ones first (green dot), then this project's past conversations. Enter brings a session's terminal tab to the front, or resumes it here. **archive** hides a row and touches nothing else. |

Also from the command line: `/mods zen on`, `/mods keepwarm off always`, `/mods stop`, `/mods sessions`.

## The mods

| Mod | Folder | What it does | Starts |
| --- | --- | --- | --- |
| **Flow** | `flow/` | While Claude works, a band above the prompt: the prompt it is on, a progress bar, the steps by number with a mark that fills in as each is done, and the subagents at work. `/flow` opens a pane with the subagents (each type under its own mark, with its recent tool calls and what it reported), the files touched by folder, and the whole task list. Claude posts its steps through a small tool the mod gives it. | on |
| **Zen** | `look/` | Hides tool calls and their output in the transcript; a failed call still shows. `/mods zen` toggles it. | off |
| **Skins** | `look/` | A color palette per project, as a Claude Code theme of the project's own. `/skin` opens the picker, `/skin ocean` picks by name. The first pick shows from the next session started in that project; after that a pick recolors the running session at once. | on |
| **Keep warm** | `keepwarm/` | After each turn, one small request shortly before the prompt cache would expire, for the next two hours, so coming back does not re-read the whole context at full price. Shows what each ping read and paid, stops when a ping finds the cache gone, and says when the cache is cold. `/keepwarm` for status, `/keepwarm now` to ping. | off |
| **Reflect** | `reflect/` | When a prompt reads like a correction or a preference, or starts with `remember:`, words it as a one-line rule and offers it above the prompt: `7` saves it for this project (`CLAUDE.local.md`), `8` for every project (`~/.claude/rules/learned.md`), `9` skips. | on |
| **Browser** | `browser/` | `/browser localhost:3000` shows a page as text in a pane: numbered links, console output, back, reload, a small color preview, and a button that hands the page to Claude with your next prompt. Pages load in headless Chrome. | on |
| **Done alert** | `mods/` | A sound and a notification when a turn that took a while ends. | on |
| Next steps | Anthropic | Up to three suggested next prompts after each turn: `1` `2` `3` to take one, `0` to dismiss. | on |
| Blast radius | Anthropic | Holds a risky shell command (`rm -rf`, `git reset --hard`, a force push, a migration) and shows what it would change. | **off** |
| You should know | built in | A side agent that points out things you might miss on longer tasks. | on |

## Things worth knowing

- **Keep warm spends usage while you are away.** Each ping re-reads the whole context at the cache-read rate. It is off until you switch it on, and a session only pings for the hours you set.
- **Reflect makes one small model call** (Haiku by default) for a prompt that reads like a correction; the prompt and the end of Claude's last reply go to that model. Set *What to look at* to `explicit` to only take `remember:`.
- **Rules saved for every project are committed with this repo**: `~/.claude/rules` is a link into `.claude/rules/`. Read `learned.md` before you push.
- **Skins write two small files**: a theme in `~/.claude/themes/` and a `theme` line in the project's `.claude/settings.local.json` (git-ignored globally here).
- **Flow adds one tool and one sentence to the system prompt** so Claude posts its steps. Switch *Ask Claude for its steps* off to track only what Claude does by itself.
- In a session that draws nowhere these mods can show (the VS Code panel, `claude -p`), Flow, Reflect, Keep warm and the alert stay out of the way.
- The mods depend on the panel (`mods`): it holds the switches they read.

## Layout

Each mod is a plugin: `.claude-plugin/plugin.json` (its options), `hooks/register.tsx` (every hook and every call on the engine),
`hooks/lib/` (plain logic and drawing, no engine calls), `types/index.d.ts` (the state it keeps for a session) and `tests/`.
