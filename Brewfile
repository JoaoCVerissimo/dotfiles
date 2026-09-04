# Brewfile — everything `brew bundle` should install on a new Mac.
# Curated by hand (not a raw `brew bundle dump`) so leftovers and build deps stay out.
# Homebrew 6 requires trusting third-party taps once:  brew trust hashicorp/tap heroku/brew jondot/tap stripe/stripe-cli supabase/tap

# ---------- Taps ----------
tap "hashicorp/tap"
tap "heroku/brew"
tap "jondot/tap"            # hygen
tap "stripe/stripe-cli"
tap "supabase/tap"

# ---------- Core CLI ----------
brew "git"
brew "gh"
brew "lazygit"
brew "direnv"
brew "jq"
brew "pre-commit"
brew "git-secret"
brew "gitleaks"             # secret scanner used by the pre-commit hook
brew "hey"                  # HTTP load generator
brew "ffmpeg"
brew "yt-dlp"

# ---------- Languages & version managers ----------
brew "nvm"
brew "pyenv"
brew "rbenv"
brew "ruby-build"
brew "rustup"               # then: rustup default stable
brew "go"

# ---------- Databases ----------
brew "postgresql@17"
brew "libpq"                # psql & friends, newest client
brew "redis"
# Older servers kept because existing projects still use them (14 is deprecated upstream)
brew "postgresql@14"
brew "postgresql@15"
brew "postgresql@16"

# ---------- Mobile / React Native ----------
brew "watchman"
brew "cocoapods"
cask "temurin@17"           # JDK 17 for Android builds (replaces the Intel-only adoptopenjdk8)
cask "react-native-debugger"
# cask "android-studio"

# ---------- Cloud & infra ----------
brew "awscli"
brew "azure-cli"
brew "hashicorp/tap/terraform"
brew "heroku/brew/heroku"
brew "stripe/stripe-cli/stripe"
brew "supabase/tap/supabase"
brew "jondot/tap/hygen"
brew "openvpn"
cask "ngrok"

# ---------- Apps ----------
cask "visual-studio-code"
cask "docker"               # Docker Desktop
cask "claude"               # Claude desktop app (Claude Code CLI is installed by bootstrap.sh)
cask "google-chrome"
cask "slack"
cask "microsoft-teams"
cask "zoom"
cask "whatsapp"
cask "notion"
cask "postman"
cask "dbeaver-community"
cask "medis"
cask "figma"
cask "origami-studio"
cask "nordvpn"
cask "openvpn-connect"
cask "anydesk"
# Not on Homebrew: GIPHY Capture (Mac App Store), Sitebulb (vendor download)

# ---------- VS Code extensions ----------
vscode "alduncanson.react-hooks-snippets"
vscode "alexcvzz.vscode-sqlite"
vscode "anthropic.claude-code"
vscode "batisteo.vscode-django"
vscode "bpruitt-goddard.mermaid-markdown-syntax-highlighting"
vscode "bradlc.vscode-tailwindcss"
vscode "burkeholland.simple-react-snippets"
vscode "christian-kohler.path-intellisense"
vscode "davidanson.vscode-markdownlint"
vscode "dbaeumer.vscode-eslint"
vscode "developer2006.svg-gallery"
vscode "eamodio.gitlens"
vscode "ecmel.vscode-html-css"
vscode "esbenp.prettier-vscode"
vscode "figma.figma-vscode-extension"
vscode "formulahendry.auto-close-tag"
vscode "github.codespaces"
vscode "github.copilot-labs"
vscode "github.vscode-github-actions"
vscode "mgmcdermott.vscode-language-babel"
vscode "ms-azuretools.vscode-azurefunctions"
vscode "ms-azuretools.vscode-azureresourcegroups"
vscode "ms-azuretools.vscode-containers"
vscode "ms-azuretools.vscode-docker"
vscode "ms-python.black-formatter"
vscode "ms-python.debugpy"
vscode "ms-python.flake8"
vscode "ms-python.isort"
vscode "ms-python.python"
vscode "ms-python.vscode-pylance"
vscode "ms-vscode-remote.remote-containers"
vscode "ms-vscode-remote.remote-ssh"
vscode "ms-vscode-remote.remote-ssh-edit"
vscode "ms-vscode.makefile-tools"
vscode "ms-vscode.remote-explorer"
vscode "ms-vsliveshare.vsliveshare"
vscode "naumovs.color-highlight"
vscode "oderwat.indent-rainbow"
vscode "pkief.material-icon-theme"
vscode "planbcoding.vscode-react-refactor"
vscode "pranaygp.vscode-css-peek"
vscode "prisma.prisma"
vscode "quicktype.quicktype"
vscode "redhat.vscode-yaml"
vscode "ritwickdey.liveserver"
vscode "simonsiefke.svg-preview"
vscode "sourcery.sourcery"
vscode "thebarkman.vscode-djaneiro"
vscode "tomoyukim.vscode-mermaid-editor"
vscode "tyriar.sort-lines"
vscode "usernamehw.errorlens"
vscode "vscode-icons-team.vscode-icons"
vscode "wayou.vscode-todo-highlight"
vscode "xabikos.javascriptsnippets"
vscode "yzhang.markdown-all-in-one"
