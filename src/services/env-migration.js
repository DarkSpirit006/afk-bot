const fs = require("node:fs");
const { saveEnvValue } = require("./env-store");

function syncMessageDefaults(envPath, env, defaults, logger) {
  if (!fs.existsSync(envPath)) return;
  for (const [key, value] of Object.entries(defaults)) {
    if (env[key] !== undefined) continue;
    try {
      saveEnvValue(envPath, key, value);
      logger.info("CONFIG", `Added ${key} to .env.`);
    } catch (error) {
      logger.warn("CONFIG", `Could not add ${key} to .env: ${error.message}`);
    }
  }
}

function syncExampleDefaults(envPath, examplePath, env, logger) {
  if (!fs.existsSync(envPath) || !fs.existsSync(examplePath)) return;
  const example = fs.readFileSync(examplePath, "utf8");
  for (const line of example.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || env[match[1]] !== undefined) continue;
    try {
      const raw = match[2];
      const value =
        raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw;
      saveEnvValue(envPath, match[1], value);
      logger.info("CONFIG", `Added ${match[1]} to .env.`);
    } catch (error) {
      logger.warn(
        "CONFIG",
        `Could not add ${match[1]} to .env: ${error.message}`,
      );
    }
  }
}

module.exports = { syncMessageDefaults, syncExampleDefaults };
