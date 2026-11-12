const DEFAULT_PORT = 25565;

/**
 * Parses "host", "host:port" or "[::1]:port" into { host, port }.
 * Throws a readable error for anything else.
 */
function parseServerAddress(address) {
  const text = String(address ?? "").trim();
  if (!text) throw new Error("Server address must not be empty.");

  const bracketed = text.match(/^\[([^\]]+)\](?::(\d+))?$/);
  const colon = text.lastIndexOf(":");
  const hasSingleColon = colon > 0 && text.indexOf(":") === colon;
  const host = bracketed
    ? bracketed[1]
    : hasSingleColon
      ? text.slice(0, colon)
      : text;
  const portText = bracketed
    ? bracketed[2]
    : hasSingleColon
      ? text.slice(colon + 1)
      : "";
  const port = portText ? Number(portText) : DEFAULT_PORT;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(
      "Server address must be a host with an optional port, for example localhost:25565.",
    );

  return { host, port };
}

module.exports = { parseServerAddress, DEFAULT_PORT };
