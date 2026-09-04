# dotfiles

My macOS dev setup as code: shell, git, Claude Code, VS Code and Homebrew packages.
Clone it on a new Mac, run one script, and the machine is back the way I like it.

Inspired by [pedrozok/dotfiles](https://github.com/pedrozok/dotfiles).

## New Mac

```sh
git clone https://github.com/JoaoCVerissimo/dotfiles.git ~/Developer/dotfiles
cd ~/Developer/dotfiles
./bootstrap.sh   # CLT, Homebrew, Brewfile, symlinks, Node/Python/Ruby/Rust, Claude Code
```

Only the symlinks, on a machine that already has the tools:

```sh
./install.sh             # add --dry-run to preview; ./uninstall.sh removes the links
```

## What's here

| Path | Goes to | Notes |
| --- | --- | --- |
| `.zshrc`, `.zprofile` | `~/` | oh-my-zsh, nvm/pyenv/rbenv, PATH, aliases; works with Homebrew in `/opt/homebrew` or `/usr/local` |
| `.gitconfig`, `.gitignore_global` | `~/` | defaults, aliases, gh as credential helper; identity is read from `~/.gitconfig.local` |
| `.ssh/config` | `~/.ssh/config` | config only, never keys |
| `.config/gh/config.yml` | `~/.config/gh/` | gh aliases; `hosts.yml` (tokens) stays out |
| `.claude/` | `~/.claude/` | `settings.json`, `CLAUDE.md`, `statusline.sh`, `agents/`, `commands/` |
| `vscode/` | `~/Library/Application Support/Code/User/` | `keybindings.json` is linked; `settings.json` is copied once (see below) |
| `Brewfile` | — | `brew bundle` manifest: taps, CLIs, apps, VS Code extensions |
| `versions.env` | — | default Node/Python/Ruby series that `bootstrap.sh` installs |
| `scripts/` | — | `vscode-export.sh` pulls live VS Code settings back into the repo, sanitized |

## Day to day

- Files in `~` are symlinks into this repo, so editing them as usual shows up in `git status` here. Commit and push.
- Track a new file: copy it in, add a `link` line to `install.sh`, run `./install.sh`.
- Add a tool: put it in `Brewfile`, run `brew bundle`. `brew bundle cleanup` lists what is installed but not in the file.
- VS Code: extensions rewrite `settings.json` with machine-specific state (trusted folders, local paths), so it is copied into place rather than linked. After changing settings, run `scripts/vscode-export.sh` and commit the sanitized result.
- Identity and secrets never enter the repo: `~/.gitconfig.local` (name and email, created by `install.sh`), `~/.zshrc.local` (tokens and machine-only exports, see `.zshrc.local.example`).

## Never committed

SSH keys, `~/.netrc`, `~/.aws`, `~/.config/gh/hosts.yml`, `~/.claude.json` (OAuth and per-project state),
`~/.claude/settings.local.json`, `~/.docker/config.json`, `~/.gnupg`.
`pre-commit install` turns on a gitleaks scan so a slip is caught before it leaves the machine.
