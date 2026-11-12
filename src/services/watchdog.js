// Half-open connection detector. If the socket dies without a TCP close
// (suspended laptop, mobile link, NAT timeout) mineflayer never emits "end", so
// we watch the position and world tick instead.
function createWatchdog({
  getBot,
  timeoutMs = 90000,
  checkIntervalMs = 15000,
  onStall,
  logger,
  now = Date.now,
}) {
  let timer;
  let lastSignature = "";
  let lastChangeAt = 0;
  let running = false;

  const signatureOf = (bot) => {
    const position = bot?.entity?.position;
    const tick = bot?.time?.time;
    if (!position) return `none:${tick ?? ""}`;
    return `${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}:${tick ?? ""}`;
  };

  const check = () => {
    const bot = getBot();
    if (!bot || !bot.entity) return;
    const signature = signatureOf(bot);
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastChangeAt = now();
      return;
    }
    if (now() - lastChangeAt < timeoutMs) return;
    logger?.warn(
      "WATCHDOG",
      `No server activity for ${Math.round(timeoutMs / 1000)}s; cycling the connection.`,
    );
    lastChangeAt = now();
    onStall?.();
  };

  return {
    start() {
      if (running || !timeoutMs) return false;
      running = true;
      lastChangeAt = now();
      lastSignature = "";
      timer = setInterval(check, Math.min(checkIntervalMs, timeoutMs));
      if (typeof timer.unref === "function") timer.unref();
      return true;
    },
    /** Called whenever the server proves it is alive (any packet we care about). */
    touch() {
      lastChangeAt = now();
      const bot = getBot();
      if (bot) lastSignature = signatureOf(bot);
    },
    stop() {
      running = false;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    isRunning: () => running,
    check,
  };
}

module.exports = { createWatchdog };
