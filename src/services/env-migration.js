const fs = require("node:fs");
const { describeError } = require("../utils/helpers");
const { saveEnvValue } = require("./env-store");

// Adds keys that are missing from an existing .env. Only runs from `npm run
// setup` / `--migrate`; doing it at startup would rewrite the user's config and
// the new values would not apply until the next restart anyway.
function migrateEnvFile({ envPath, examplePath, messages, logger }) {
  if (!fs.existsSync(envPath)) return [];
  const added = [];
  const values = new Map();

  if (examplePath && fs.existsSync(examplePath)) {
    for (const line of fs.readFileSync(examplePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const raw = match[2];
      let value = raw;
      if (raw.startsWith('"') && raw.endsWith('"')) {
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw.slice(1, -1);
        }
      }
      values.set(match[1], value);
    }
  }
  for (const [key, value] of Object.entries(messages)) values.set(key, value);

  const current = fs.readFileSync(envPath, "utf8");
  for (const [key, value] of values) {
    if (new RegExp(`^\\s*${key}\\s*=`, "m").test(current)) continue;
    try {
      saveEnvValue(envPath, key, value);
      added.push(key);
      logger?.info("CONFIG", `Added ${key} to .env.`);
    } catch (error) {
      logger?.warn(
        "CONFIG",
        `Could not add ${key} to .env: ${describeError(error)}`,
      );
    }
  }
  return added;
}

module.exports = { migrateEnvFile };
