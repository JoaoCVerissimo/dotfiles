#!/usr/bin/env bash
# One-shot setup for a new Mac. Safe to re-run. Run install.sh afterwards if you only want the symlinks.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$DOTFILES/versions.env"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Xcode Command Line Tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  echo "Finish the Command Line Tools installer, then re-run this script."; exit 1
fi

step "Homebrew (native Apple Silicon build in /opt/homebrew)"
if [[ ! -x /opt/homebrew/bin/brew && ! -x /usr/local/bin/brew ]]; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; else eval "$(/usr/local/bin/brew shellenv)"; fi

step "Trusting third-party taps (Homebrew 6)"
brew trust hashicorp/tap heroku/brew stripe/stripe-cli supabase/tap 2>/dev/null || true

step "brew bundle"
brew bundle --file="$DOTFILES/Brewfile"

step "Symlinking dotfiles"
"$DOTFILES/install.sh"

step "oh-my-zsh"
[[ -d "$HOME/.oh-my-zsh" ]] || sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended --keep-zshrc

step "Node ($NODE_VERSION via nvm)"
export NVM_DIR="$HOME/.nvm"; mkdir -p "$NVM_DIR"
# shellcheck disable=SC1091
source "$(brew --prefix nvm)/nvm.sh"
nvm install "$NODE_VERSION" && nvm alias default "$NODE_VERSION"
npm install -g pnpm hygen

step "Python ($PYTHON_SERIES via pyenv)"
export PYENV_ROOT="$HOME/.pyenv"; eval "$(pyenv init - bash)"
pyenv install --skip-existing "$PYTHON_SERIES"
pyenv global "$(pyenv versions --bare | grep "^$PYTHON_SERIES" | tail -1)"

step "Ruby ($RUBY_SERIES via rbenv)"
eval "$(rbenv init - bash)"
RUBY_LATEST="$(rbenv install --list 2>/dev/null | grep -E "^$RUBY_SERIES\.[0-9]+$" | tail -1)"
rbenv install --skip-existing "$RUBY_LATEST" && rbenv global "$RUBY_LATEST"

step "Rust (rustup)"
rustup default stable >/dev/null 2>&1 || rustup-init -y --no-modify-path

step "Claude Code"
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash

step "Secrets hook for this repo"
(cd "$DOTFILES" && pre-commit install) || true

step "Manual follow-ups"
cat <<'TXT'
  - gh auth login
  - Copy ~/.zshrc.local.example to ~/.zshrc.local and add tokens/exports
  - Restore ~/.ssh keys from your password manager / backup
  - Sign in to Docker Desktop, VS Code (Settings Sync), Claude
TXT
