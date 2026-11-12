# Minecraft AFK Bot

A Mineflayer bot that keeps a Minecraft account online. It handles AuthMe
(chat prompts and the newer login dialogs), follows players around, and answers
a few chat commands from whoever you put in charge.

Use it on your own server, or any server that allows bots.

## Requirements

- Node.js 22 or newer (mineflayer 4.37 needs it)
- git

## Setup

```sh
git clone https://github.com/DarkSpirit006/afk-bot.git
cd afk-bot
npm install
npm run setup
```

`npm run setup` asks a few questions, writes `.env` and starts the bot.
`npm start` from then on just starts it.

On Windows and Termux you can skip the clone:

<!-- BRANCH_INSTALL_POWERSHELL_START -->
```powershell
irm "https://raw.githubusercontent.com/DarkSpirit006/afk-bot/main/install.ps1" | iex
```
<!-- BRANCH_INSTALL_POWERSHELL_END -->

<!-- BRANCH_INSTALL_TERMUX_START -->
```sh
curl -fsSL "https://raw.githubusercontent.com/DarkSpirit006/afk-bot/main/install.sh" | bash
```
<!-- BRANCH_INSTALL_TERMUX_END -->

## Configuration

Everything lives in `.env`. Copy `.env.example` or run `npm run setup`.

```env
MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=AFK_Bot
MC_AUTH=offline
MASTER_USERNAME=YourName
AUTH_PASSWORD=""
```

`MASTER_USERNAME` is required, the bot will not start without it. All the other
settings are documented in [docs/configuration.md](docs/configuration.md).

## Commands

`MASTER_USERNAME` and anyone added with `!master` can use all of these.
`!public` lets normal players use the movement commands.

| Command | Who | What it does |
| --- | --- | --- |
| `!status` `!pos` `!health` | anyone | uptime, coordinates, health |
| `!cmd` | anyone | list the commands you are allowed to use |
| `!follow` `!come [x y z]` `!stopfollow` | master or public | move the bot |
| `!master` `!rm` `!bl` `!rmbl` | master | permissions and blacklist |
| `!public` `!private` `!tpa on\|off` | master | access and teleport policy |
| `!y [id]` `!n [id]` | master | accept or reject a teleport request |
| `!say <text>` | primary master | make the bot talk |
| `!stop` | primary master | shut the bot down |

Changes made with these commands are written back to `.env`, so they survive a
restart.

## AuthMe

Both login styles work:

- **Chat prompts.** The bot watches server messages for `/login` and `/register`
  prompts. Player chat is ignored, so nobody can trick it into sending the
  password.
- **Dialogs** (AuthMe 6 on MC 1.21.6+). Includes the pre-join dialog that shows
  up before you are actually in the world, plus registration, email recovery
  and 2FA with `AUTH_TOTP_SECRET`.

Set `AUTH_PASSWORD` and it just works. `FEATURE_AUTHME` and
`FEATURE_AUTH_DIALOG` turn each half off if you do not need it.

## Notes

- Commands are only taken from player chat, and the sender is read from the
  chat packet, not guessed from the text. Rank prefixes like `[Admin]` cannot be
  used to pretend to be the owner.
- The bot only walks when it is safe to: not while hurt, in water or lava, or
  standing on something that will kill it. `AFK_STYLE=walk` is opt-in.
- Reconnects back off instead of hammering the server, and stop for good on a
  ban, whitelist rejection or failed login.
- `WATCHDOG_MS` restarts the connection if the server goes quiet, which catches
  the half-dead sockets that never fire a disconnect.
- Set `HEALTH_PORT` if you want a `/healthz` JSON endpoint for uptime monitoring.

## Development

```sh
npm test        # 130+ tests, no server needed
npm run lint
npm run update  # pull the installed branch, then start
npm run migrate # add new settings to an existing .env
```

The bot itself is in `src/bot.js`; the pieces it uses are in `src/services`,
`src/auth`, `src/commands` and `src/navigation`. Tests inject a fake bot, so the
command and dialog paths can be checked without connecting anywhere.

## License

MIT.
