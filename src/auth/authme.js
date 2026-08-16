function createAuthMe({ getBot, password, logger }) {
  let actionTaken = false;
  const reset = () => {
    actionTaken = false;
  };
  const inspect = (message) => {
    if (!password || actionTaken) return;
    const text = String(message).toLowerCase();
    const register =
      /(register|registr|create).*(password|pass)|password.*(register|twice|again)/.test(
        text,
      );
    const login =
      /(login|log in|authenticate|auth).*(password|pass)|password.*(login|authentication)/.test(
        text,
      );
    const existing =
      /(already registered|already exist|account exists|use \/login)/.test(
        text,
      );
    if (register && !existing) {
      actionTaken = true;
      getBot().chat(`/register ${password} ${password}`);
      logger.info(
        "AUTH",
        "Registration prompt detected; sending authentication command.",
      );
    } else if (login || existing) {
      actionTaken = true;
      getBot().chat(`/login ${password}`);
      logger.info(
        "AUTH",
        "Login prompt detected; sending authentication command.",
      );
    }
  };
  return { inspect, reset };
}
module.exports = { createAuthMe };
