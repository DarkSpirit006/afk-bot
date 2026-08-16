# Minecraft AFK Bot

[![Build](https://img.shields.io/github/actions/workflow/status/DarkSpirit006/afk-bot/test.yml?branch=main&style=for-the-badge&label=BUILD)](https://github.com/DarkSpirit006/afk-bot/actions/workflows/test.yml)
[![CodeFactor](https://www.codefactor.io/repository/github/DarkSpirit006/afk-bot/badge?style=for-the-badge)](https://www.codefactor.io/repository/github/DarkSpirit006/afk-bot)
[![Repo size](https://img.shields.io/github/repo-size/DarkSpirit006/afk-bot?style=for-the-badge&label=REPO%20SIZE)](https://github.com/DarkSpirit006/afk-bot)
[![Code size](https://img.shields.io/github/languages/code-size/DarkSpirit006/afk-bot?style=for-the-badge&label=CODE%20SIZE)](https://github.com/DarkSpirit006/afk-bot)
[![License](https://img.shields.io/github/license/DarkSpirit006/afk-bot?style=for-the-badge)](LICENSE)

A self-hosted Mineflayer bot for Minecraft servers you are allowed to automate. It provides restrained AFK movement, reconnects safely, supports AuthMe prompts, navigation, teleport requests, and master-controlled commands from an ordinary terminal.

## Features

- Configurable AFK movement that pauses for navigation
- AuthMe registration/login prompt handling (passwords are never logged)
- Automatic reconnect with a configurable delay
- `!follow`, `!come`, and `!stopfollow` pathfinding commands
- Primary/secondary master permissions and persistent blacklist
- Configurable `/tpa` and `/tpahere` approval flow
- Feature switches, log levels, configuration validation, and unit tests

## Requirements and installation

Use Node.js 18 or newer. Clone the repository, then install dependencies:

```sh
npm install
npm run setup
```

`npm run setup` creates `.env`, preserving existing configuration unless you choose a fresh setup. Start a configured bot with:

```sh
npm start
```

### Windows PowerShell

<!-- BRANCH_INSTALL_POWERSHELL_START -->

```powershell
irm "https://raw.githubusercontent.com/DarkSpirit006/afk-bot/main/install.ps1" | iex
```

<!-- BRANCH_INSTALL_POWERSHELL_END -->

### Linux / Termux

<!-- BRANCH_INSTALL_TERMUX_START -->

```sh
curl -fsSL "https://raw.githubusercontent.com/DarkSpirit006/afk-bot/main/install.sh" | bash
```

<!-- BRANCH_INSTALL_TERMUX_END -->

Windows users can also run [install.ps1](install.ps1) locally; Linux and Termux users can run [install.sh](install.sh). The installers retain existing files and `.env`; review a remote script before piping it into a shell.

## Quick configuration

Copy [.env.example](.env.example) to `.env` if you prefer manual setup. `MASTER_USERNAME` is required and must be a valid Minecraft username. Do not commit `.env`.

```env
MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=AFK_Bot
MASTER_USERNAME=YourMinecraftName
AUTH_PASSWORD=""
LOG_LEVEL=info
```

See [configuration](docs/configuration.md) for every setting. At startup the bot reports its server, username, and authentication mode, but never the password.

## Commands and permissions

The primary master and names in `MASTERS` are masters. `!public` permits ordinary users to use navigation commands; blacklisted players are always denied.

| Command                                           | Access               | Purpose                      |
| ------------------------------------------------- | -------------------- | ---------------------------- |
| `!status`, `!cmd`                                 | Anyone               | Bot uptime / command help    |
| `!follow`, `!come [x y z]`, `!stopfollow`         | Master unless public | Navigation                   |
| `!stop`                                           | Primary master       | Gracefully stops the bot     |
| `!master`, `!rm master`, `!bl`, `!rmbl`           | Master               | Manage permissions           |
| `!public`, `!private`, `!tpa on\|off`, `!y`, `!n` | Master               | Access and teleport requests |

Full examples and arguments are in [commands](docs/commands.md).

## AuthMe, navigation, and TPA

When `AUTH_PASSWORD` is set and AuthMe-like server text requests a login or registration, the bot sends the normal server command. It does not bypass authentication. AuthMe detection, AFK movement, navigation, and TPA handling can each be disabled with feature flags.

`!follow` and player-targeted `!come` require the bot to see the player. Coordinate `!come x y z` is useful when it cannot. Pathfinding will not dig blocks.

When teleport acceptance is disabled for non-masters, the bot asks a master to answer `!y` or `!n`; requests expire after 30 seconds.

## Updating and development

The installer URL selects the checkout branch, and `npm start`/`npm run afk` update only that branch before launching. If an existing checkout has uncommitted changes, branch switching stops safely. Pull and review updates yourself, then run setup to install dependencies or fill in newly introduced setup values:

```sh
git pull --ff-only
npm run setup
npm test
```

Run `npm run check` for syntax checks. The test suite covers configuration, permissions, parsing, and reconnect scheduling. Mineflayer/server connectivity needs a real authorized server and is not exercised in CI.

## Troubleshooting and supported versions

Mineflayer determines protocol support; set `MC_VERSION` only to a version supported by the installed Mineflayer release, or leave it blank for automatic detection. For connection, authentication, installation, and navigation issues, read [troubleshooting](docs/troubleshooting.md).

<!--
## Demo

No screenshots are included yet. A terminal demonstration should show configuration loading, connection, AuthMe state (without the password), AFK state, command output, and reconnect notices.
-->

## Contributors

This project is maintained by [DarkSpirit006](https://github.com/DarkSpirit006). Contributions and improvements are welcome through pull requests.

[![Contributors](https://contrib.rocks/image?repo=DarkSpirit006/afk-bot)](https://github.com/DarkSpirit006/afk-bot/graphs/contributors)

[View all contributors](https://github.com/DarkSpirit006/afk-bot/graphs/contributors)

## Contributing and license

Keep secrets out of commits, add tests for behavior changes, and avoid executing chat-provided shell commands. Licensed under the [MIT License](LICENSE).
