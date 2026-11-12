const MESSAGES = require("./defaults");
const { parseBoolean, parseList } = require("../utils/helpers");

const TRUE_VALUES = new Set(["true", "1", "yes", "on", "enabled"]);

function createEnvReader(env, warnings) {
  const read = (name) => {
    const value = env[name];
    if (value === undefined) return undefined;
    const text = String(value).trim();
    return text === "" ? undefined : text;
  };
  return {
    read,
    string(name, fallback) {
      return read(name) ?? fallback;
    },
    integer(name, fallback, min, max) {
      const raw = read(name);
      if (raw === undefined) return fallback;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        warnings.push(
          `${name} must be an integer between ${min} and ${max}; using ${fallback}.`,
        );
        return fallback;
      }
      return parsed;
    },
    float(name, fallback, min, max) {
      const raw = read(name);
      if (raw === undefined) return fallback;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        warnings.push(
          `${name} must be a number between ${min} and ${max}; using ${fallback}.`,
        );
        return fallback;
      }
      return parsed;
    },
    boolean(name, fallback) {
      const raw = read(name);
      if (raw === undefined) return fallback;
      const normalized = raw.toLowerCase();
      if (
        !TRUE_VALUES.has(normalized) &&
        !["false", "0", "no", "off", "disabled"].includes(normalized)
      ) {
        warnings.push(`${name} is not a boolean; using ${fallback}.`);
        return fallback;
      }
      return parseBoolean(raw, fallback);
    },
    list(name) {
      return parseList(read(name) || "");
    },
  };
}

function loadConfig(env = process.env) {
  const warnings = [];
  const reader = createEnvReader(env, warnings);
  const messages = Object.fromEntries(
    Object.entries(MESSAGES).map(([key, fallback]) => [
      key,
      reader.string(key, fallback),
    ]),
  );

  const config = {
    host: reader.string("MC_HOST", "localhost"),
    port: reader.integer("MC_PORT", 25565, 1, 65535),
    username: reader.string("MC_USERNAME", "AFK_Bot"),
    auth: reader.string("MC_AUTH", "offline").toLowerCase(),
    version: reader.string("MC_VERSION", false) || false,
    password: reader.string("AUTH_PASSWORD", ""),
    commandPrefix: reader.string("COMMAND_PREFIX", "!"),
    logLevel: reader.string("LOG_LEVEL", "info").toLowerCase(),
    logFile: reader.string("LOG_FILE", ""),
    features: {
      afk: reader.boolean("FEATURE_AFK", true),
      authme: reader.boolean("FEATURE_AUTHME", true),
      navigation: reader.boolean("FEATURE_NAVIGATION", true),
      tpa: reader.boolean("FEATURE_TPA", true),
      authDialog: reader.boolean("FEATURE_AUTH_DIALOG", true),
    },
    authMe: {
      maxAttempts: reader.integer("AUTH_MAX_ATTEMPTS", 3, 1, 20),
      retryMs: reader.integer("AUTH_RETRY_MS", 5000, 1000, 600000),
      email: reader.string("AUTH_EMAIL", ""),
      totpSecret: reader.string("AUTH_TOTP_SECRET", ""),
    },
    reconnect: {
      baseMs: reader.integer("RECONNECT_MS", 10000, 1000, 3600000),
      maxMs: reader.integer("RECONNECT_MAX_MS", 300000, 1000, 86400000),
      maxAttempts: reader.integer("RECONNECT_MAX_ATTEMPTS", 0, 0, 10000),
      jitter: reader.float("RECONNECT_JITTER", 0.2, 0, 1),
    },
    afk: {
      enabled: reader.boolean("MOVE_ENABLED", true),
      style: reader.string("AFK_STYLE", "look").toLowerCase(),
      intervalMs: reader.integer("MOVE_EVERY_MS", 30000, 5000, 3600000),
      minHealth: reader.integer("AFK_MIN_HEALTH", 8, 0, 20),
      wanderRadius: reader.integer("WANDER_RADIUS", 16, 2, 4096),
    },
    navigation: {
      followRange: reader.integer("FOLLOW_RANGE", 2, 1, 16),
      maxRecalculations: reader.integer("NAV_MAX_RECALCULATIONS", 5, 1, 100),
      maxCoordinate: reader.integer(
        "NAV_MAX_COORDINATE",
        30000000,
        16,
        30000000,
      ),
    },
    teleport: {
      approvalMs: reader.integer("TELEPORT_APPROVAL_MS", 30000, 1000, 600000),
      cooldownMs: reader.integer("TPA_COOLDOWN_MS", 5000, 0, 600000),
    },
    chat: {
      minIntervalMs: reader.integer("CHAT_MIN_INTERVAL_MS", 1000, 0, 60000),
      maxQueue: reader.integer("CHAT_MAX_QUEUE", 24, 1, 1000),
      rateLimit: {
        limit: reader.integer("RATE_LIMIT_COUNT", 4, 1, 1000),
        windowMs: reader.integer("RATE_LIMIT_WINDOW_MS", 10000, 1000, 600000),
      },
    },
    watchdogMs: reader.integer("WATCHDOG_MS", 90000, 0, 86400000),
    health: {
      host: reader.string("HEALTH_HOST", "127.0.0.1"),
      port: reader.integer("HEALTH_PORT", 0, 0, 65535),
    },
    blacklist: reader.list("BLACKLIST"),
    primaryMaster: reader.string("MASTER_USERNAME", ""),
    masters: reader.list("MASTERS"),
    allowOtherPlayers: reader.boolean("ALLOW_OTHER_PLAYERS", false),
    tpaEnabled: reader.boolean("TPA_ENABLED", true),
    tpahereEnabled: reader.boolean("TPAHERE_ENABLED", true),
    messages,
    warnings,
  };

  if (config.reconnect.maxMs < config.reconnect.baseMs)
    config.reconnect.maxMs = config.reconnect.baseMs;

  return config;
}

module.exports = { loadConfig, MESSAGES };
