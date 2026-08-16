const defaults = require("./defaults");
const { parseBoolean, parseList } = require("../utils/helpers");

function number(value, fallback, min) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}
function loadConfig(env = process.env) {
  const messages = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, env[key] ?? value]),
  );
  return {
    host: env.MC_HOST || "localhost",
    port: number(env.MC_PORT, 25565, 1),
    username: env.MC_USERNAME || "AFK_Bot",
    auth: env.MC_AUTH || "offline",
    version: env.MC_VERSION || false,
    password: env.AUTH_PASSWORD || "",
    reconnectMs: number(env.RECONNECT_MS, 10000, 1000),
    moveEveryMs: number(env.MOVE_EVERY_MS, 30000, 5000),
    moveEnabled: parseBoolean(env.MOVE_ENABLED, true),
    commandPrefix: env.COMMAND_PREFIX || "!",
    logLevel: (env.LOG_LEVEL || "info").toLowerCase(),
    features: {
      afk: parseBoolean(env.FEATURE_AFK, true),
      authme: parseBoolean(env.FEATURE_AUTHME, true),
      navigation: parseBoolean(env.FEATURE_NAVIGATION, true),
      tpa: parseBoolean(env.FEATURE_TPA, true),
    },
    blacklist: parseList(env.BLACKLIST),
    primaryMaster: String(env.MASTER_USERNAME || "").trim(),
    masters: parseList(env.MASTERS),
    allowOtherPlayers: parseBoolean(env.ALLOW_OTHER_PLAYERS, false),
    tpaEnabled: parseBoolean(env.TPA_ENABLED, true),
    tpahereEnabled: parseBoolean(env.TPAHERE_ENABLED, true),
    messages,
  };
}
module.exports = { loadConfig };
