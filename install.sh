#!/usr/bin/env bash
set -euo pipefail
LAUNCH_DIR="$PWD"
APP_DIR="$LAUNCH_DIR"
REPO_URL="${AFK_BOT_REPO:-https://github.com/DarkSpirit006/afk-bot.git}"
# Updated to this branch by .github/workflows/sync-installer-branch.yml.
DEFAULT_REPO_BRANCH="main"
REPO_BRANCH="${AFK_BOT_BRANCH:-$DEFAULT_REPO_BRANCH}"
if command -v termux-info >/dev/null 2>&1 || [ -n "${TERMUX_VERSION:-}" ]; then PLATFORM=termux
elif [ "$(uname -s 2>/dev/null || true)" = Linux ]; then PLATFORM=linux
else echo 'This installer supports Termux and Linux.'; exit 1; fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js was not found; installing it for $PLATFORM..."
  if [ "$PLATFORM" = termux ]; then pkg update -y; pkg install -y nodejs-lts
  elif command -v apt-get >/dev/null 2>&1; then [ "$(id -u)" -eq 0 ] && APT= || APT=sudo; $APT apt-get update; $APT apt-get install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then [ "$(id -u)" -eq 0 ] && PAC= || PAC=sudo; $PAC pacman -Sy --noconfirm nodejs npm
  else echo 'No supported package manager found.'; exit 1; fi
fi
if ! command -v git >/dev/null 2>&1; then
  echo "Git was not found; installing it for $PLATFORM..."
  if [ "$PLATFORM" = termux ]; then pkg install -y git
  elif command -v apt-get >/dev/null 2>&1; then [ "$(id -u)" -eq 0 ] && APT= || APT=sudo; $APT apt-get install -y git
  elif command -v pacman >/dev/null 2>&1; then [ "$(id -u)" -eq 0 ] && PAC= || PAC=sudo; $PAC pacman -S --noconfirm git
  else echo 'No supported package manager found to install git.'; exit 1; fi
fi
merge_checkout() {
  local source_dir="$1"
  shopt -s dotglob nullglob
  local checkout_files=("$source_dir"/*)
  local file name
  for file in "${checkout_files[@]}"; do
    name="${file##*/}"
    if [ -e "$APP_DIR/$name" ]; then
      echo "Keeping existing $APP_DIR/$name; remove it or merge it manually if needed."
    else
      mv "$file" "$APP_DIR/"
    fi
  done
  rmdir "$source_dir" 2>/dev/null || echo "Some files remain in $source_dir because matching files already existed."
  shopt -u dotglob nullglob
}

if [ ! -f "$APP_DIR/setup.js" ]; then
  # Releases that installed into a nested folder are migrated to the launch
  # directory so future npm commands work from the directory where install.sh
  # was invoked.
  for legacy_name in minecraft-afk-bot afk-bot; do
    LEGACY_DIR="$LAUNCH_DIR/$legacy_name"
    if [ -f "$LEGACY_DIR/setup.js" ]; then
      merge_checkout "$LEGACY_DIR"
      echo "Migrated the previous $legacy_name installation into the current directory."
      break
    fi
  done
fi
if [ ! -f "$APP_DIR/setup.js" ]; then
  [ -n "$REPO_URL" ] || { echo 'Set AFK_BOT_REPO or run this from the project directory.'; exit 1; }
  command -v git >/dev/null 2>&1 || { echo 'git is required to download the project.'; exit 1; }
  mkdir -p "$APP_DIR"
  if [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ] && [ ! -d "$APP_DIR/.git" ]; then
    DOWNLOAD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/afk-bot.XXXXXX")"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$DOWNLOAD_DIR"
    merge_checkout "$DOWNLOAD_DIR"
  else
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
  fi
elif [ -d "$APP_DIR/.git" ]; then
  INSTALLED_BRANCH="$(git -C "$APP_DIR" branch --show-current)"
  [ -n "$INSTALLED_BRANCH" ] || { echo 'Cannot update a detached Git checkout. Check out the branch originally used for installation first.'; exit 1; }
  if [ "$INSTALLED_BRANCH" != "$REPO_BRANCH" ]; then
    STASH_CREATED=0
    if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then
      STASH_NAME="installer-switch-$(date +%Y%m%d%H%M%S)"
      echo "Stashing local changes before switching branches..."
      git -C "$APP_DIR" stash push --include-untracked -m "$STASH_NAME" >/dev/null
      STASH_CREATED=1
    fi
    echo "Switching checkout from $INSTALLED_BRANCH to installer branch $REPO_BRANCH..."
    git -C "$APP_DIR" fetch origin "$REPO_BRANCH"
    if ! git -C "$APP_DIR" checkout "$REPO_BRANCH"; then
      git -C "$APP_DIR" checkout -b "$REPO_BRANCH" "origin/$REPO_BRANCH"
    fi
    if [ "$STASH_CREATED" -eq 1 ]; then
      echo "Restoring stashed changes..."
      if ! git -C "$APP_DIR" stash pop >/dev/null 2>&1; then
        echo "Some stashed changes could not be reapplied automatically; resolve them manually."
      fi
    fi
  fi
  INSTALLED_BRANCH="$REPO_BRANCH"
  echo "Updating only from origin/$INSTALLED_BRANCH..."
  git -C "$APP_DIR" pull --ff-only origin "$INSTALLED_BRANCH"
fi
cd "$APP_DIR"
if [ -t 0 ]; then
  node setup.js
else
  if [ -e /dev/tty ]; then
    node setup.js < /dev/tty
  else
    node setup.js
  fi
fi

# A script cannot change the working directory of the shell that invoked it.
# Print the exact command needed for later runs when the checkout was cloned
# into a dedicated directory (the common Termux/home-directory case).
echo
echo "Installation directory: $APP_DIR"
echo "To start the bot again, run:"
printf 'cd %q && npm start\n' "$APP_DIR"

