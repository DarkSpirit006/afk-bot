const COMMANDS = ["status", "follow", "come", "stopfollow", "stop", "cmd", "y", "n", "master", "rm", "bl", "rmbl", "public", "private", "tpa"];
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function parseCommand(message, prefix, sender = "") {
  const pattern = new RegExp(`${escapeRegExp(prefix)}(${COMMANDS.join("|")})(?![A-Za-z0-9_])`, "gi");
  const matches = [...String(message).matchAll(pattern)]; const match = matches.at(-1); if (!match) return undefined;
  if (!sender && match.index > 0 && !/(?:>|\u00bb|\u2192|:)\s*$/.test(String(message).slice(0, match.index))) return undefined;
  return { name: match[1].toLowerCase(), index: match.index, args: message.slice(match.index + match[0].length).trim().split(/\s+/).filter(Boolean) };
}
module.exports = { COMMANDS, parseCommand };
