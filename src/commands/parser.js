const { COMMAND_NAMES } = require("./registry");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Finds the last command in a chat line. With a known sender the prefix may sit
// anywhere after their name; without one it has to start the line, so broadcasts
// and MOTDs are not mistaken for commands.
function parseCommand(message, prefix, sender = "") {
  const text = String(message ?? "");
  const pattern = new RegExp(
    `${escapeRegExp(prefix)}(${COMMAND_NAMES.join("|")})(?![A-Za-z0-9_])`,
    "gi",
  );
  const matches = [...text.matchAll(pattern)];
  const match = matches.at(-1);
  if (!match) return undefined;

  if (
    !sender &&
    match.index > 0 &&
    !/(?:>|»|→|:)\s*$/.test(text.slice(0, match.index))
  )
    return undefined;

  return {
    name: match[1].toLowerCase(),
    index: match.index,
    args: text
      .slice(match.index + match[0].length)
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  };
}

module.exports = { parseCommand };
