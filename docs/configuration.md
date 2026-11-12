# Configuration

All settings are read from `.env`. Start from `.env.example` or run
`npm run setup`.

Bad values are reported at startup: a typo in `MC_PORT` gets a warning and the
default, a bad `MC_AUTH` stops the bot.

## Connection

| Variable | Default | |
| --- | --- | --- |
| `MC_HOST` | `localhost` | server address |
| `MC_PORT` | `25565` | server port |
| `MC_USERNAME` | `AFK_Bot` | account name, 3-16 letters, numbers, underscores |
| `MC_AUTH` | `offline` | `offline`, `microsoft` or `mojang` |
| `MC_VERSION` | auto | pin a protocol version like `1.21.6` if detection fails |

## AuthMe

| Variable | Default | |
| --- | --- | --- |
| `AUTH_PASSWORD` | empty | password for `/login` and `/register` |
| `FEATURE_AUTHME` | `true` | answer chat prompts |
| `FEATURE_AUTH_DIALOG` | `true` | answer login dialogs (MC 1.21.6+) |
| `AUTH_EMAIL` | empty | email for registration and recovery dialogs |
| `AUTH_TOTP_SECRET` | empty | base32 secret, so the bot can do 2FA |
| `AUTH_MAX_ATTEMPTS` | `3` | give up after this many tries |
| `AUTH_RETRY_MS` | `5000` | wait before retrying a rejected login |

AuthMe kicks or locks accounts after a few wrong passwords, so the bot stops at
`AUTH_MAX_ATTEMPTS` rather than keep going.

## Reconnecting

| Variable | Default | |
| --- | --- | --- |
| `RECONNECT_MS` | `10000` | first retry delay, doubles each time |
| `RECONNECT_MAX_MS` | `300000` | cap for that delay |
| `RECONNECT_MAX_ATTEMPTS` | `0` | `0` means never give up |
| `RECONNECT_JITTER` | `0.2` | random spread on the delay |
| `WATCHDOG_MS` | `90000` | restart if nothing happens for this long, `0` to disable |

Bans, whitelist rejections and login failures are not retried.

## Idle movement

| Variable | Default | |
| --- | --- | --- |
| `FEATURE_AFK` | `true` | master switch |
| `MOVE_ENABLED` | `true` | turn movement on |
| `AFK_STYLE` | `look` | `look` or `walk` |
| `MOVE_EVERY_MS` | `30000` | how often it acts |
| `AFK_MIN_HEALTH` | `8` | do nothing below this health |
| `WANDER_RADIUS` | `16` | how far `walk` may drift from spawn |

Movement is skipped over lava, fire, cactus, magma, campfires, powder snow,
berry bushes and air, and while swimming.

## Navigation

| Variable | Default | |
| --- | --- | --- |
| `FEATURE_NAVIGATION` | `true` | enable `!follow`, `!come`, `!stopfollow` |
| `FOLLOW_RANGE` | `2` | blocks to keep while following |
| `NAV_MAX_RECALCULATIONS` | `5` | failed paths before giving up |
| `NAV_MAX_COORDINATE` | `30000000` | limit for `!come x y z` (Y is capped at 2048) |

It never digs. `!come` without coordinates needs the player in sight.

## Teleports

| Variable | Default | |
| --- | --- | --- |
| `FEATURE_TPA` | `true` | handle `/tpa` and `/tpahere` |
| `TPA_ENABLED`, `TPAHERE_ENABLED` | `true` | accept that request type automatically |
| `TELEPORT_APPROVAL_MS` | `30000` | how long a request waits for `!y` |
| `TPA_COOLDOWN_MS` | `5000` | minimum gap between accepted teleports |

Masters are always accepted. Everyone else gets in automatically when access is
public and the request type is enabled, otherwise a master is asked.

## Chat limits

| Variable | Default | |
| --- | --- | --- |
| `CHAT_MIN_INTERVAL_MS` | `1000` | gap between messages the bot sends |
| `CHAT_MAX_QUEUE` | `24` | queue size before messages are dropped |
| `RATE_LIMIT_COUNT` | `4` | commands per player per window |
| `RATE_LIMIT_WINDOW_MS` | `10000` | length of that window |

## Permissions

| Variable | Default | |
| --- | --- | --- |
| `MASTER_USERNAME` | required | owner, cannot be removed or blacklisted |
| `MASTERS` | empty | extra masters, comma separated |
| `BLACKLIST` | empty | names that get no access |
| `ALLOW_OTHER_PLAYERS` | `false` | let non-masters use movement commands |
| `COMMAND_PREFIX` | `!` | change it if `!` clashes with another plugin |

## Logging and monitoring

| Variable | Default | |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `LOG_FILE` | empty | also append log lines to this file |
| `HEALTH_HOST` | `127.0.0.1` | bind address for the health endpoint |
| `HEALTH_PORT` | `0` | `0` disables it, otherwise serves `GET /healthz` |

## Messages

Every reply the bot sends can be reworded with the `*_MESSAGE` variables at the
bottom of `.env.example`. You can use `{player}`, `{master}`, `{type}`,
`{status}`, `{seconds}`, `{x}`, `{y}`, `{z}`, `{health}`, `{food}` and
`{coordinates}`, and a `|` splits one message into separate chat lines.

The defaults live in `src/config/defaults.js`; `.env.example` is generated from
it and a test fails if the two drift apart.
