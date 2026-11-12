const fs = require("node:fs");

/** Serialises a value the way dotenv expects to read it back. */
function serializeValue(value) {
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  return JSON.stringify(String(value ?? ""));
}

function readEnvValues(envPath) {
  const values = {};
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    try {
      values[key] = JSON.parse(raw);
    } catch {
      values[key] = raw.trim();
    }
  }
  return values;
}

// One key in .env. Written to a temp file and renamed, so a crash or a full disk
// cannot leave a half-written config behind.
function saveEnvValue(envPath, key, value) {
  if (!fs.existsSync(envPath))
    throw new Error("Cannot save settings: .env was not found.");
  const current = fs.readFileSync(envPath, "utf8");
  const line = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const next = `${key}=${serializeValue(value)}`;
  const contents = line.test(current)
    ? current.replace(line, next.replace(/\$/g, "$$$$"))
    : `${current.replace(/\s*$/, "\n")}${next}\n`;

  const temporary = `${envPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, envPath);
  return contents;
}

module.exports = { readEnvValues, saveEnvValue, serializeValue };
