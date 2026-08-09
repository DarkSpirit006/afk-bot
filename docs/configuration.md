# Configuration

All values live in `.env`. Strings with spaces should be quoted. Never share `AUTH_PASSWORD` or commit `.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `MC_HOST`, `MC_PORT` | `localhost`, `25565` | Minecraft server address. |
| `MC_USERNAME` | `AFK_Bot` | Bot account name. |
| `MC_AUTH` | `offline` | Mineflayer authentication mode. |
| `MC_VERSION` | blank | Optional Mineflayer protocol version. |
| `AUTH_PASSWORD` | blank | AuthMe password; never logged. |
| `MOVE_ENABLED`, `MOVE_EVERY_MS` | `true`, `30000` | Enables gentle periodic AFK movement and its interval. |
| `RECONNECT_MS` | `10000` | Delay before reconnecting after an unexpected disconnect. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |
| `FEATURE_AFK`, `FEATURE_AUTHME` | `true` | Enables AFK movement or AuthMe prompt handling. |
| `FEATURE_NAVIGATION`, `FEATURE_TPA` | `true` | Enables navigation commands or teleport-request handling. |
| `COMMAND_PREFIX` | `!` | Prefix for bot commands. |
| `MASTER_USERNAME`, `MASTERS` | required, blank | Primary master and comma-separated secondary masters. |
| `BLACKLIST` | blank | Comma-separated names denied bot access. |
| `ALLOW_OTHER_PLAYERS` | `false` | Allows non-masters to use navigation commands. |
| `TPA_ENABLED`, `TPAHERE_ENABLED` | `true` | Automatically accept the respective request type for permitted players. |

Every bot chat reply is customizable through the `*_MESSAGE` variables in `.env.example`, including blacklist denials and navigation cancellation when a target leaves. They support placeholders such as `{player}`, `{master}`, `{type}`, `{status}`, `{seconds}`, and `{coordinates}`. Help message values use `|` to split chat lines.
