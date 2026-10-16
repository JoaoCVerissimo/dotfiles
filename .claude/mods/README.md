# Claude Code mods

Six [mods](https://code.claude.com/docs/en/plugins/mods/overview) of my own, plus three of Anthropic's installed as they ship,
all switched from one panel. They are read straight from this folder, so an edit here is live after `/reload-plugins`.

**The panel, Peek and the Done alert start on**: all three are plain code and cost no tokens. Every other mod
starts off and does nothing (and costs nothing) until it is switched on there: for one session, or for every session.

```sh
scripts/claude-mods.sh     # from the repo root: registers this folder and installs everything (idempotent)
.claude/mods/check.sh      # validates and tests every mod
```

Needs Claude Code 2.1.296 or later, in a terminal (the fullscreen renderer docks panes as a sidebar from 110 columns).

## The panel

`/mods`, or the `◆ mods · control · sessions` buttons on the hint line under the prompt. The `✕` on the pane closes it.

Everything is clicked (or reached with Tab and pressed with Enter). **No key acts on a single press**, in the panel or in any
mod here, so a stray key never switches anything: with a pane open, what you type still goes to the prompt.

| Tab | What it does |
| --- | --- |
| **Mods** | One row per mod, each off until you switch it. Click its name to switch it **for this session**. The right side of the row says what the mod adds to your usage and opens its page: the **always** switch (every session), the usage note, and its settings. Always-switches and settings are Claude Code's own plugin options, so they land in `settings.json` (`pluginConfigs`). Anthropic's mods switch whole, for every session. |
| **Control** | The model and the effort this session is on, marked in green, each a click to change, with what new sessions start with under each row. A click runs `/model` or `/effort` for you; one that would also change a default asks for a second click first (see below). Then **stop this turn**, and `/focus`, `/fast`, `/context`, `/usage`, `/recap`, `/compact`, `/clear`, rename. The permission mode is not here: a panel cannot switch it, so it stays on shift+tab. |
| **Sessions** | Every session on this machine, live ones first (green dot), then this project's past conversations. Click one to bring its terminal tab to the front, or to resume it here. The `[ ⊟ ]` icon on a row **archives** it: that hides the row and touches nothing else. *archived* shows the hidden rows, where `[ ⊞ ]` brings one back. |

Also from the command line: `/mods zen on`, `/mods keepwarm off always`, `/mods stop`, `/mods sessions`.

## The mods

Peek and the Done alert start **on**, the rest **off**. The last column is what one adds to your usage once it is on.

| Mod | Folder | What it does | Extra usage |
| --- | --- | --- | --- |
| **Flow** | `flow/` | While Claude works, a band above the prompt: the prompt it is on, a progress bar, the steps by number with a mark that fills in as each is done, and the subagents at work. `/flow` opens a pane with the subagents (each type under its own mark, with its recent tool calls and what it reported), the files touched by folder, and the whole task list. Claude posts its steps through a small tool the mod gives it. | few tokens |
| **Zen** | `look/` | Hides tool calls and their output in the transcript; a failed call still shows. `/mods zen` toggles it. | none |
| **Skins** | `look/` | A color palette per project, as a Claude Code theme of the project's own: it colors the prompt box, Claude's marks and your own messages. `/skin` opens the picker, `/skin ocean` picks by name, `/skin none` removes it. A first pick shows from the next session started in that folder; after that a pick recolors the running session at once. | none |
| **Keep warm** | `keepwarm/` | After each turn, one small request shortly before the prompt cache would expire, for the next two hours, so coming back does not re-read the whole context at full price. Shows what each ping read and paid, stops when a ping finds the cache gone, and says when the cache is cold. `/keepwarm` for status, `/keepwarm now` to ping. | **tokens** |
| **Reflect** | `reflect/` | When a prompt reads like a correction or a preference, or starts with `remember:`, words it as a one-line rule and offers it above the prompt with three buttons: save for this project (`CLAUDE.local.md`), save everywhere (`~/.claude/rules/learned.md`), or skip. | few tokens |
| **Peek** | `peek/` | A small preview above the prompt box of each image pasted into it (`[Image #1]`), drawn in colored half-block cells so Apple Terminal can show it, with an **Open** button that shows the picture itself in a small window over the terminal. | none |
| **Done alert** | `mods/` | When a turn that took a while ends: a sound, and a mark on the session's terminal (its own notification where it has one, else its bell, which marks the tab). | none |
| Next steps | Anthropic | Up to three suggested next prompts after each turn. Its number keys are Anthropic's own: `1` `2` `3` put a suggestion in the prompt box as a draft (nothing is sent until you press Enter), `0` dismisses. | **tokens** |
| Blast radius | Anthropic | Holds a risky shell command (`rm -rf`, `git reset --hard`, a force push, a migration) and shows what it would change. | none |
| You should know | built in | A side agent that points out things you might miss on longer tasks. | **tokens** |

A mod's own command (`/flow`, `/skin`, `/keepwarm`, `/reflect`) says so when the mod is off, and where to
switch it on.

## What uses tokens

A mod left off uses nothing: it declares no tool to Claude, adds nothing to the prompt and makes no request. What
follows is what each one adds once it is on. The panel shows it on every row (`no tokens`, `few tokens`, `tokens`) and
spells it out on each mod's page.

**Plain code, no model call:** Zen, Skins, Peek, Done alert, Blast radius, and the panel itself
(switches, control center, session list). The Control tab's buttons run the commands you would type, so `/compact` and
`/recap` cost what they always cost.

**A few tokens:**

- **Flow**: the steps tool's definition and one sentence in the system prompt, plus a short tool call each time a step
  starts or ends. Switch *Ask Claude for its steps* off and Flow is plain code. Switch Flow off in the middle of a
  session and the sentence goes, and the tool is put away behind tool search under a one-line description (a tool
  Claude has been given cannot be taken back entirely).
- **Reflect**: one small Haiku call (under a thousand tokens) when a prompt reads like a correction or a preference. None
  for `remember:` or any other prompt, and none at all with *What to look at* on `explicit`. A saved rule is then one line
  in the context of later sessions.

**Model requests of their own:**

- **Next steps**: one extra request after each turn that ends in an answer of 80 characters or more. It re-reads the
  conversation at the cached price and writes up to three short suggestions.
- **You should know**: a side agent while Claude works on longer tasks. It is built into Claude Code, and Anthropic does
  not say how much it uses.
- **Keep warm**: each ping re-reads the whole conversation at the cached price, about a tenth of normal input, for a
  one-word reply. One ping every 50 minutes with a 1-hour cache, every 4 minutes with a 5-minute one, for the hours you
  set after your last turn.

## Things worth knowing

- **A pick in the Control tab cannot be kept to the session, so one that changes a default asks twice.** Claude Code
  saves a model set with `/model <name>`, and an effort set with `/effort <level>`, as the default for new sessions
  whenever the command runs in a live session, and gives a mod no other way to set them. `max` is the one level it keeps
  to the session (as do the `/effort` slider's *s* and the `/model` picker, which only you can use). So a click that
  would change what new sessions start with first says so under its row, and is run when clicked again; `max`, and a
  pick that already is the default, run at once. The effort stays when the model changes, and through `/clear`.
- **The green mark on the effort is the panel's own bookkeeping.** Claude Code tells a mod the session's model and not
  its effort, so the panel starts from the level settings keep for the model and follows every `/effort` it sees,
  clicked or typed. One thing it cannot see is the `/effort` slider's *s, for this session only*: that shows once a turn
  has run. With *auto*, the level the last turn ran at is written beside it.
- **Reflect never edits a `CLAUDE.md`, and you choose where each rule goes.** *Save for this project* writes that
  project's `CLAUDE.local.md`, which is yours alone (the mod lists it in the repository's own exclude file). *Save
  everywhere* writes `~/.claude/rules/learned.md`, which Claude Code reads in every project. `install.sh` links that
  folder into this repo (`.claude/rules/`), so a rule saved everywhere shows up in `git status` here and travels to the
  next machine once it is committed. This repo is public, and so is a rule pushed with it.
- **Reflect sends the prompt it words to a model** (Haiku by default), with the end of Claude's last reply. Set *What to
  look at* to `explicit` to only take `remember:`.
- **The done alert posts no banner of its own.** macOS files a banner posted from a script under Script Editor, and
  opens that when the banner is clicked. So the alert asks the terminal instead: iTerm2, kitty and Ghostty have
  notifications of their own, and a click on one goes to the session. Apple's Terminal has none, so there the alert
  rings the bell on the session's own tab, which Terminal marks (and badges in the Dock when it is in the background).
  With an audible bell that is a second sound beside the alert's: set *Alert sound* to `none`, or switch *Mark the
  terminal* off, to keep one.
- **A skin belongs to the project, and a first pick cannot show in the session it is made in.** Claude Code settles a
  session's theme when the session starts and lets no mod swap it, so the pick is saved and shows from the next session
  started in that folder. From then on the project wears it in every session, with Skins switched on or not, and a new
  pick recolors a running session at once. Switching Skins off in a session turns the project plain, and on again
  brings its skin back.
- **Skins write two small files**: a theme in `~/.claude/themes/` and a `theme` line in the project's `.claude/settings.local.json` (git-ignored globally here).
- In a session that draws nowhere these mods can show (the VS Code panel, `claude -p`), Flow, Reflect, Keep warm and the alert stay out of the way.
- The mods depend on the panel (`mods`): it holds the switches they read.

## Layout

Each mod is a plugin: `.claude-plugin/plugin.json` (its options), `hooks/register.tsx` (every hook and every call on the engine),
`hooks/lib/` (plain logic and drawing, no engine calls), `types/index.d.ts` (the state it keeps for a session) and `tests/`.
What each mod adds to your usage is written once, in `mods/hooks/lib/catalog.ts`, which the panel reads.
