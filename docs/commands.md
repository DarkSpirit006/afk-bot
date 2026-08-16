# Commands

| Command               | Aliases | Arguments        | Permission     | Description / example                         |
| --------------------- | ------- | ---------------- | -------------- | --------------------------------------------- |
| `!status`             | —       | none             | anyone         | Shows uptime.                                 |
| `!cmd`                | —       | none             | anyone         | Shows available commands.                     |
| `!follow`             | —       | none             | master/public  | Follow the sender.                            |
| `!come`               | —       | optional `x y z` | master/public  | Walk to the sender, or `!come 10 64 -20`.     |
| `!stopfollow`         | —       | none             | master/public  | Cancels follow or destination navigation.     |
| `!stop`               | —       | none             | primary master | Gracefully stops the process.                 |
| `!master`             | —       | username         | master         | Adds a secondary master.                      |
| `!rm master`          | —       | username         | master         | Removes a secondary master.                   |
| `!bl`, `!rmbl`        | —       | username         | master         | Adds/removes a blacklist entry.               |
| `!public`, `!private` | —       | none             | master         | Opens/restricts navigation access.            |
| `!tpa on\|off`        | —       | state            | master         | Toggles both teleport request types.          |
| `!y`, `!n`            | —       | none             | master         | Accepts/rejects the current approval request. |

Commands are case-insensitive. Minecraft names are validated before being saved. The primary master cannot be removed or blacklisted.
