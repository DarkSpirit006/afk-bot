# Troubleshooting

## Node.js or installation fails

Install Node.js 18+ and Git, then run `npm install`. Use `npm run check` to find syntax errors. Installers do not overwrite existing files; resolve merge messages manually.

## Invalid configuration

Run `npm run setup` to create or repair `.env`. Startup errors identify the invalid value. `MASTER_USERNAME` is mandatory.

## Authentication fails

Check `AUTH_PASSWORD` locally and verify the server actually uses an AuthMe-compatible command format. The bot only reacts to prompt text; it cannot bypass server authentication.

## Disconnects or reconnect loops

Check the server address, version, firewall, account mode, and server bot policy. Increase `RECONNECT_MS` if the server rate-limits reconnects. Kicks are printed without exposing credentials.

## Navigation cannot reach a player

The player must be visible for `!follow` and player-based `!come`. Try `!come x y z`, ensure `FEATURE_NAVIGATION=true`, and remember the bot will not dig through blocks.

## Commands or TPA are ignored

Check `MASTER_USERNAME`, `MASTERS`, `ALLOW_OTHER_PLAYERS`, `BLACKLIST`, and `FEATURE_TPA`. A blacklisted player is always denied. TPA approvals expire after 30 seconds.
