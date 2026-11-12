const { USERNAME, isIntegerInRange } = require("../utils/helpers");
const { decodeBase32 } = require("../utils/totp");
const { LEVELS } = require("../utils/logger");

const AUTH_MODES = new Set(["offline", "microsoft", "mojang"]);
const AFK_STYLES = new Set(["look", "walk"]);

/**
 * Validates a loaded configuration.
 * Returns { errors, warnings }; errors stop startup, warnings are logged.
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [...(config.warnings || [])];

  if (!String(config.host || "").trim())
    errors.push("MC_HOST must not be empty.");
  if (!isIntegerInRange(config.port, 1, 65535))
    errors.push("MC_PORT must be between 1 and 65535.");
  if (!USERNAME.test(String(config.username || "")))
    errors.push(
      "MC_USERNAME must be a valid Minecraft username (3-16 letters, numbers, or underscores).",
    );
  if (!config.primaryMaster || !USERNAME.test(config.primaryMaster))
    errors.push(
      "MASTER_USERNAME must be a valid Minecraft username. Run npm run setup to configure it.",
    );
  if (!AUTH_MODES.has(config.auth))
    errors.push("MC_AUTH must be offline, microsoft, or mojang.");
  if (!Object.hasOwn(LEVELS, config.logLevel))
    errors.push("LOG_LEVEL must be debug, info, warn, or error.");
  if (!String(config.commandPrefix || "").trim())
    errors.push("COMMAND_PREFIX must not be empty.");
  if (!AFK_STYLES.has(config.afk.style))
    errors.push("AFK_STYLE must be look or walk.");
  if (!isIntegerInRange(config.health.port, 0, 65535))
    errors.push("HEALTH_PORT must be 0 (disabled) or between 1 and 65535.");

  if (config.authMe.totpSecret) {
    try {
      decodeBase32(config.authMe.totpSecret);
    } catch (error) {
      warnings.push(
        `AUTH_TOTP_SECRET is not a valid base32 secret (${error.message}); 2FA codes will be skipped.`,
      );
    }
  }
  if (config.features.authDialog && !config.features.authme && !config.password)
    warnings.push(
      "FEATURE_AUTH_DIALOG is enabled but AUTH_PASSWORD is empty; login dialogs will be ignored.",
    );
  if (config.features.authme && !config.password)
    warnings.push(
      "FEATURE_AUTHME is enabled but AUTH_PASSWORD is empty; login prompts will be ignored.",
    );
  if (!config.features.authme && config.password)
    warnings.push(
      "AUTH_PASSWORD is set but FEATURE_AUTHME is disabled; the password will not be used.",
    );
  if (config.allowOtherPlayers)
    warnings.push(
      "ALLOW_OTHER_PLAYERS is enabled: any player on the server can use navigation commands.",
    );
  if (config.auth === "offline" && config.password)
    warnings.push(
      "MC_AUTH is offline, so AUTH_PASSWORD is only used for AuthMe server prompts.",
    );
  if (config.afk.style === "walk" && config.afk.wanderRadius > 64)
    warnings.push(
      "AFK_STYLE walk with a large WANDER_RADIUS can move the bot far from its spawn point.",
    );

  return { errors, warnings };
}

/** Backwards-compatible helper that only returns the blocking problems. */
function validateConfigErrors(config) {
  return validateConfig(config).errors;
}

module.exports = {
  validateConfig,
  validateConfigErrors,
  AUTH_MODES,
  AFK_STYLES,
};
