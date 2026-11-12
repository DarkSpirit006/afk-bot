/** Kicks that will never succeed on retry; reconnecting just spams the server. */
const PERMANENT_REASONS = [
  /\bbanned?\b/i,
  /\bwhitelist/i,
  /\bnot (?:authenticated|allowed)\b/i,
  /\bfailed to authenticate\b/i,
  /\binvalid session\b/i,
  /\bname (?:is )?(?:already )?(?:taken|in use)\b/i,
  /\bunable to connect to (?:auth|session|microsoft)\b/i,
];

function isPermanentReason(reason) {
  const text =
    typeof reason === "string" ? reason : JSON.stringify(reason ?? "");
  return PERMANENT_REASONS.some((pattern) => pattern.test(text));
}

// Reconnect with capped exponential backoff plus jitter. Bans, whitelist
// rejections and auth failures are permanent, so we stop instead of retrying.
function createReconnect({
  baseDelayMs = 10000,
  maxDelayMs = 300000,
  maxAttempts = 0,
  jitter = 0.2,
  connect,
  logger,
  schedule = setTimeout,
  cancel = clearTimeout,
  random = Math.random,
  onGiveUp,
}) {
  let timer;
  let attempts = 0;
  let gaveUp = false;

  const computeDelay = (attempt) => {
    const exponential = Math.min(
      maxDelayMs,
      baseDelayMs * 2 ** Math.max(0, attempt - 1),
    );
    if (!jitter) return Math.round(exponential);
    const spread = exponential * jitter;
    return Math.round(
      Math.max(baseDelayMs, exponential - spread + random() * spread * 2),
    );
  };

  const giveUp = (reason) => {
    gaveUp = true;
    logger?.error("RECONNECT", reason);
    onGiveUp?.(reason);
  };

  return {
    schedule(reason) {
      if (timer !== undefined || gaveUp) return false;

      const permanent = reason !== undefined && isPermanentReason(reason);
      if (permanent) {
        giveUp(
          `Not reconnecting: the server rejected the bot permanently (${
            typeof reason === "string" ? reason : "kicked"
          }).`,
        );
        return false;
      }

      if (maxAttempts > 0 && attempts >= maxAttempts) {
        giveUp(`Giving up after ${attempts} reconnect attempts.`);
        return false;
      }

      attempts += 1;
      const delay = computeDelay(attempts);
      logger?.info(
        "RECONNECT",
        `Attempt ${attempts}${
          maxAttempts > 0 ? `/${maxAttempts}` : ""
        }; retrying in ${(delay / 1000).toFixed(1)}s.`,
      );
      timer = schedule(() => {
        timer = undefined;
        connect();
      }, delay);
      return true;
    },
    reset() {
      attempts = 0;
      gaveUp = false;
    },
    cancel() {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
    attempts: () => attempts,
    gaveUp: () => gaveUp,
    nextDelayMs: () => computeDelay(attempts + 1),
  };
}

module.exports = { createReconnect, isPermanentReason, PERMANENT_REASONS };
