const { describeError } = require("../utils/helpers");

// Outgoing chat queue. bot.chat() is fire and forget, and dumping four replies
// at once gets you muted on most servers, so everything is sent one message per
// minIntervalMs with a capped queue behind it.
function createChatQueue({
  send,
  minIntervalMs = 1000,
  maxQueue = 24,
  logger,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const queue = [];
  let timer;
  let lastSentAt = null;
  let stopped = false;

  const clear = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };

  const drain = () => {
    timer = undefined;
    if (stopped || !queue.length) return;
    const wait = lastSentAt === null ? 0 : minIntervalMs - (now() - lastSentAt);
    if (wait > 0) {
      timer = schedule(drain, wait);
      return;
    }
    const text = queue.shift();
    lastSentAt = now();
    try {
      send(text);
    } catch (error) {
      logger?.warn("CHAT", `Could not send a message: ${describeError(error)}`);
    }
    if (queue.length) timer = schedule(drain, minIntervalMs);
  };

  return {
    push(text) {
      const value = String(text ?? "").trim();
      if (stopped || !value) return false;
      if (queue.length >= maxQueue) {
        logger?.warn(
          "CHAT",
          `Outbound queue is full (${maxQueue}); dropping a message.`,
        );
        return false;
      }
      queue.push(value);
      if (timer === undefined) drain();
      return true;
    },
    size: () => queue.length,
    pending: () => [...queue],
    stop() {
      stopped = true;
      queue.length = 0;
      clear();
    },
  };
}

module.exports = { createChatQueue };
