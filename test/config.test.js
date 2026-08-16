const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config/config");
const { validateConfig } = require("../src/config/validation");

test("configuration parses supported feature flags and list values", () => {
  const config = loadConfig({
    MC_HOST: "example.org",
    MC_PORT: "25570",
    MC_USERNAME: "AFK_Bot",
    MASTER_USERNAME: "Owner",
    MASTERS: "Helper, Other",
    BLACKLIST: "Blocked",
    FEATURE_AFK: "false",
  });
  assert.equal(config.port, 25570);
  assert.equal(config.features.afk, false);
  assert.equal(config.masters.has("helper"), true);
  assert.equal(config.blacklist.has("blocked"), true);
  assert.deepEqual(validateConfig(config), []);
});
test("configuration validation reports unsafe startup settings", () => {
  const config = loadConfig({
    MC_PORT: "70000",
    MC_USERNAME: "x",
    MASTER_USERNAME: "",
  });
  assert.ok(validateConfig(config).length >= 3);
});
