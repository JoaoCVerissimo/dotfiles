#!/usr/bin/env bash
# Links the files in this repo into $HOME. Idempotent.
#   ./install.sh            link everything
#   ./install.sh --dry-run  print what would happen, change nothing
# Existing real files are moved to ~/.dotfiles-backup/<timestamp>/ first.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)"
VSCODE_USER="$HOME/Library/Application Support/Code/User"
DRY_RUN=0
[[ "${1:-}" == "-n" || "${1:-}" == "--dry-run" ]] && DRY_RUN=1

run() { if [[ $DRY_RUN -eq 1 ]]; then printf '  would: %s\n' "$*"; else "$@"; fi; }

# link <repo path> <target>: symlink, backing up a real file that is in the way
link() {
  local src="$DOTFILES/$1" dst="$2"
  if [[ -e "$dst" && "$dst" -ef "$src" ]]; then echo "ok         $dst"; return; fi
  run mkdir -p "$(dirname "$dst")"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    run mkdir -p "$BACKUP/$(dirname "${dst#"$HOME"/}")"
    run mv "$dst" "$BACKUP/${dst#"$HOME"/}"
    echo "backed up  $dst"
  fi
  run ln -sfn "$src" "$dst"
  echo "linked     $dst"
}

# seed <repo path> <target>: copy once, never overwrite (for files that tools rewrite on their own)
seed() {
  local src="$DOTFILES/$1" dst="$2"
  if [[ -e "$dst" ]]; then echo "kept       $dst (pull changes back with scripts/vscode-export.sh)"; return; fi
  run mkdir -p "$(dirname "$dst")"
  run cp "$src" "$dst"
  echo "seeded     $dst"
}

# git identity stays out of the repo: ~/.gitconfig.local, created from the current config or by asking
setup_git_identity() {
  local f="$HOME/.gitconfig.local" name email
  if [[ -f "$f" ]]; then echo "ok         $f"; return; fi
  name="$(git config --global user.name 2>/dev/null || true)"
  email="$(git config --global user.email 2>/dev/null || true)"
  if [[ ( -z "$name" || -z "$email" ) && -t 0 ]]; then
    read -r -p "git user.name: " name
    read -r -p "git user.email: " email
  fi
  if [[ $DRY_RUN -eq 1 ]]; then printf '  would: write %s (%s <%s>)\n' "$f" "$name" "$email"; return; fi
  printf '[user]\n\tname = %s\n\temail = %s\n' "$name" "$email" > "$f"
  echo "created    $f"
  [[ -z "$name" || -z "$email" ]] && echo "           fill in your name and email in $f"
  return 0
}

# Shell
link .zshrc            "$HOME/.zshrc"
link .zprofile         "$HOME/.zprofile"

# Git (identity first, while the old ~/.gitconfig is still readable)
setup_git_identity
link .gitconfig        "$HOME/.gitconfig"
link .gitignore_global "$HOME/.gitignore_global"

# SSH (config only; keys never live in this repo)
link .ssh/config       "$HOME/.ssh/config"
run chmod 700 "$HOME/.ssh"

# GitHub CLI (config only; hosts.yml holds tokens and is never linked)
link .config/gh/config.yml "$HOME/.config/gh/config.yml"

# Claude Code (user scope)
link .claude/settings.json "$HOME/.claude/settings.json"
link .claude/CLAUDE.md     "$HOME/.claude/CLAUDE.md"
link .claude/statusline.sh "$HOME/.claude/statusline.sh"
link .claude/agents        "$HOME/.claude/agents"
link .claude/commands      "$HOME/.claude/commands"
link .claude/rules         "$HOME/.claude/rules"

# VS Code: keybindings are linked; settings.json is seeded because extensions write machine state into it
link vscode/keybindings.json "$VSCODE_USER/keybindings.json"
seed vscode/settings.json    "$VSCODE_USER/settings.json"

# Claude Code mods: mine are read from .claude/mods/, Anthropic's are installed (needs claude on PATH)
if [[ $DRY_RUN -eq 1 ]]; then echo "  would: scripts/claude-mods.sh"; else "$DOTFILES/scripts/claude-mods.sh"; fi

[[ -d "$BACKUP" ]] && echo "Previous files saved under $BACKUP"
if [[ $DRY_RUN -eq 1 ]]; then echo "(dry run: nothing changed)"; else echo "Done. Open a new terminal (or run: source ~/.zshrc)."; fi
