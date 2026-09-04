# ~/.zshrc — managed by the dotfiles repo (symlinked by install.sh).
# Machine-specific values and secrets go in ~/.zshrc.local (never committed).

# ---------- oh-my-zsh ----------
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git poetry)
source "$ZSH/oh-my-zsh.sh"

# ---------- PATH ----------
export PATH="$HOME/.local/bin:$PATH"                     # claude, poetry, pipx, uv, ...
export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"

# Go (official installer lives in /usr/local/go; Homebrew's go is already on PATH)
[[ -d /usr/local/go/bin ]] && export PATH="$PATH:/usr/local/go/bin"
[[ -d "$HOME/go/bin" ]] && export PATH="$PATH:$HOME/go/bin"

# Postgres client/server binaries, resolved through the active Homebrew prefix
if [[ -n "$HOMEBREW_PREFIX" ]]; then
  [[ -d "$HOMEBREW_PREFIX/opt/libpq/bin" ]] && export PATH="$HOMEBREW_PREFIX/opt/libpq/bin:$PATH"
  [[ -d "$HOMEBREW_PREFIX/opt/postgresql@17/bin" ]] && export PATH="$HOMEBREW_PREFIX/opt/postgresql@17/bin:$PATH"
fi

# ---------- Version managers ----------
# Node (nvm): the curl-installed copy in ~/.nvm if present, else Homebrew's
export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh"
elif [[ -n "$HOMEBREW_PREFIX" && -s "$HOMEBREW_PREFIX/opt/nvm/nvm.sh" ]]; then
  source "$HOMEBREW_PREFIX/opt/nvm/nvm.sh"
fi
[[ -s "$NVM_DIR/bash_completion" ]] && source "$NVM_DIR/bash_completion"

# Python (pyenv, with the pyenv-virtualenv plugin in ~/.pyenv/plugins)
export PYENV_ROOT="$HOME/.pyenv"
[[ -d "$PYENV_ROOT/bin" ]] && export PATH="$PYENV_ROOT/bin:$PATH"
command -v pyenv >/dev/null && eval "$(pyenv init - zsh)"

# Ruby (rbenv)
command -v rbenv >/dev/null && eval "$(rbenv init - zsh)"

# ---------- Mobile (React Native) ----------
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
[[ -d "$ANDROID_HOME" ]] && export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"   # appended: platform-tools ships its own sqlite3
# JDK for Android builds (Temurin 17 from the Brewfile). Uncomment once installed:
# export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"

# ---------- Tool hooks & completions ----------
command -v direnv >/dev/null && eval "$(direnv hook zsh)"
if command -v terraform >/dev/null; then
  autoload -U +X bashcompinit && bashcompinit
  complete -o nospace -C "$(command -v terraform)" terraform
fi

# Legacy: pins the Docker API for the old Docker Desktop 4.6. Remove after updating Docker Desktop.
export DOCKER_API_VERSION=1.41

# ---------- Aliases ----------
alias zesh='code ~/.zshrc'
alias reload='source ~/.zshrc'
alias tf='terraform'
alias migrations='python manage.py makemigrations'
alias migrate='python manage.py migrate'
alias dk='docker compose -f ./docker-compose.yml'
alias dk-up='docker compose -f ./docker-compose.yml up -d'
alias dk-down='docker compose -f ./docker-compose.yml down'

# ---------- Local overrides (secrets, work-only exports) ----------
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"
