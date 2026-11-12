const { describeError, normalizeMessage } = require("../utils/helpers");

// AuthMe chat prompts (/login, /register). Only server output is inspected, and
// it has to read like an actual prompt, otherwise a player asking about "the
// login password" is enough to make the bot send its own password.
const REGISTER_PROMPT =
  /(?:^|\s)\/(?:register|reg)\b|\bplease register\b|\bregister(?:ation)? (?:with|using|to)\b|\btype \/register\b|\b\/register <password>/i;
const LOGIN_PROMPT =
  /(?:^|\s)\/(?:login|log)\b|\bplease (?:login|log in|authenticate)\b|\btype \/login\b|\b\/login <password>/i;
const ALREADY_REGISTERED =
  /already (?:registered|exists)|account (?:already )?exists|use \/login/i;
const FAILURE =
  /wrong password|incorrect password|invalid password|login failed|authentication failed|too many (?:login )?attempts|password does not match|not registered yet/i;

function createAuthMe({
  getBot,
  password,
  maxAttempts = 3,
  retryMs = 5000,
  logger,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let attempts = 0;
  let lastAttemptAt = 0;
  let waitingUntil = 0;
  let gaveUp = false;
  let timer;

  const reset = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    attempts = 0;
    lastAttemptAt = 0;
    waitingUntil = 0;
    gaveUp = false;
  };

  const send = (kind) => {
    if (attempts >= maxAttempts) {
      gaveUp = true;
      logger?.error(
        "AUTH",
        `Gave up after ${attempts} authentication attempts; check AUTH_PASSWORD for this account.`,
      );
      return;
    }
    const bot = getBot();
    if (!bot || typeof bot.chat !== "function") return;
    attempts += 1;
    lastAttemptAt = now();
    const command =
      kind === "register"
        ? `/register ${password} ${password}`
        : `/login ${password}`;
    try {
      bot.chat(command);
    } catch (error) {
      logger?.warn(
        "AUTH",
        `Could not send authentication: ${describeError(error)}`,
      );
      return;
    }
    logger?.info(
      "AUTH",
      `${
        kind === "register" ? "Registration" : "Login"
      } prompt detected; sent the authentication command (attempt ${attempts}/${maxAttempts}).`,
    );
  };

  return {
    /** Inspect one line of **server** output. Player chat must never reach this. */
    inspect(message) {
      if (!password || gaveUp) return false;
      const text = normalizeMessage(message);
      if (!text) return false;

      if (FAILURE.test(text)) {
        logger?.warn(
          "AUTH",
          "The server rejected the authentication attempt; retrying shortly.",
        );
        waitingUntil = now() + retryMs;
        if (timer !== undefined) cancel(timer);
        timer = schedule(() => {
          timer = undefined;
          if (!gaveUp) send("login");
        }, retryMs);
        return true;
      }

      if (attempts > 0 && now() < waitingUntil) return false;
      if (attempts > 0 && now() - lastAttemptAt < retryMs) return false;

      if (ALREADY_REGISTERED.test(text)) {
        send("login");
        return true;
      }
      if (REGISTER_PROMPT.test(text)) {
        send("register");
        return true;
      }
      if (LOGIN_PROMPT.test(text)) {
        send("login");
        return true;
      }
      return false;
    },
    reset,
    attempts: () => attempts,
    gaveUp: () => gaveUp,
    isWaiting: () => now() < waitingUntil,
  };
}

module.exports = { createAuthMe, REGISTER_PROMPT, LOGIN_PROMPT };
