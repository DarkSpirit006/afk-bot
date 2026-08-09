const fs = require("node:fs");
function saveEnvValue(envPath, key, value) {
  if (!fs.existsSync(envPath)) throw new Error("Cannot save settings: .env was not found.");
  const current = fs.readFileSync(envPath, "utf8"); const line = new RegExp(`^${key}=.*$`, "m"); const next = `${key}=${JSON.stringify(value)}`;
  fs.writeFileSync(envPath, line.test(current) ? current.replace(line, next) : `${current.replace(/\s*$/, "\n")}${next}\n`, "utf8");
}
module.exports = { saveEnvValue };
