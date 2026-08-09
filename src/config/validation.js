const { USERNAME } = require("../utils/helpers");
const { LEVELS } = require("../utils/logger");
function validateConfig(config) {
  const errors = [];
  if (!config.host.trim()) errors.push("MC_HOST must not be empty.");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.push("MC_PORT must be between 1 and 65535.");
  if (!USERNAME.test(config.username)) errors.push("MC_USERNAME must be a valid Minecraft username (3-16 letters, numbers, or underscores).");
  if (!config.primaryMaster || !USERNAME.test(config.primaryMaster)) errors.push("MASTER_USERNAME must be a valid Minecraft username. Run npm run setup to configure it.");
  if (!Object.hasOwn(LEVELS, config.logLevel)) errors.push("LOG_LEVEL must be debug, info, warn, or error.");
  if (!config.commandPrefix.trim()) errors.push("COMMAND_PREFIX must not be empty.");
  return errors;
}
module.exports = { validateConfig };
