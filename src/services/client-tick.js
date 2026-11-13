// Closes the client tick on servers that ask for it.
//
// Since 1.21.3 a server only accepts one position packet per client tick, and
// it ends the tick when it sees a `tick_end` packet. Mineflayer never sends
// one, so the second movement packet of the session trips the check and the
// player is dropped with "Invalid move player packet received". Sending it
// after each movement packet keeps the count at one.

const { findPacketId } = require("../auth/click-action");

const MOVEMENT_PACKETS = new Set(["position", "position_look", "look", "flying"]);

/**
 * Wraps client.write so movement packets are followed by a tick_end.
 * Returns a function that removes the wrapper.
 */
function installClientTick({ client, version, logger, onWarn } = {}) {
  if (!client || typeof client.write !== "function") return () => {};
  const known = version ?? client.version;
  if (findPacketId(known, "play", "tick_end") === undefined) return () => {};

  const write = client.write.bind(client);
  let closing = false;

  client.write = (name, params) => {
    const result = write(name, params);
    if (closing || !MOVEMENT_PACKETS.has(name)) return result;
    // Not inside the body above: a nested tick_end would recurse.
    closing = true;
    try {
      write("tick_end", {});
    } catch (error) {
      const message = `Could not close the client tick: ${error?.message ?? error}`;
      if (onWarn) onWarn(message);
      else logger?.warn("CONNECTION", message);
    } finally {
      closing = false;
    }
    return result;
  };

  return () => {
    client.write = write;
  };
}

module.exports = { installClientTick };
