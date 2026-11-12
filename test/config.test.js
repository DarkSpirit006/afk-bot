// configuration loading, validation and the .env helpers

const MESSAGES = require("../src/config/defaults");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  readEnvValues,
  saveEnvValue,
  serializeValue,
} = require("../src/services/env-store");
const { buildEnvExample } = require("../src/config/env-example");
const { loadConfig } = require("../src/config/config");
const { migrateEnvFile } = require("../src/services/env-migration");
const { validateConfig } = require("../src/config/validation");

const BASE = {
  MC_HOST: "example.org",
  MC_PORT: "25570",
  MC_USERNAME: "AFK_Bot",
  MASTER_USERNAME: "Owner",
};

test("configuration parses supported values", () => {
  const config = loadConfig({
    ...BASE,
    MASTERS: "Helper, Other",
    BLACKLIST: "Blocked",
    FEATURE_AFK: "no",
    MOVE_ENABLED: "0",
    RECONNECT_JITTER: "0.5",
    TELEPORT_APPROVAL_MS: "45000",
  });
  assert.equal(config.port, 25570);
  assert.equal(config.features.afk, false);
  assert.equal(config.afk.enabled, false);
  assert.equal(config.reconnect.jitter, 0.5);
  assert.equal(config.teleport.approvalMs, 45000);
  assert.equal(config.masters.has("helper"), true);
  assert.equal(config.blacklist.has("blocked"), true);
  assert.deepEqual(validateConfig(config).errors, []);
  assert.deepEqual(config.warnings, []);
});

test("boolean parsing accepts common spellings", () => {
  for (const value of ["true", "1", "yes", "ON", "enabled"])
    assert.equal(
      loadConfig({ ...BASE, FEATURE_AFK: value }).features.afk,
      true,
    );
  for (const value of ["false", "0", "no", "off", "disabled"])
    assert.equal(
      loadConfig({ ...BASE, FEATURE_AFK: value }).features.afk,
      false,
    );
});

test("invalid numbers fall back and are reported", () => {
  const config = loadConfig({
    ...BASE,
    MC_PORT: "70000",
    MOVE_EVERY_MS: "abc",
  });
  assert.equal(config.port, 25565);
  assert.equal(config.afk.intervalMs, 30000);
  assert.match(config.warnings.join("\n"), /MC_PORT/);
  assert.match(config.warnings.join("\n"), /MOVE_EVERY_MS/);
});

test("validation reports unsafe startup settings", () => {
  const config = loadConfig({
    MC_PORT: "70000",
    MC_USERNAME: "x",
    MASTER_USERNAME: "",
  });
  const { errors } = validateConfig(config);
  assert.equal(errors.length, 2);
  assert.match(errors.join("\n"), /MC_USERNAME/);
  assert.match(errors.join("\n"), /MASTER_USERNAME/);
  assert.match(config.warnings.join("\n"), /MC_PORT/);
});

test("validation warns about risky but valid settings", () => {
  const config = loadConfig({
    ...BASE,
    ALLOW_OTHER_PLAYERS: "true",
    FEATURE_AUTHME: "true",
    AUTH_PASSWORD: "",
    AFK_STYLE: "walk",
    WANDER_RADIUS: "128",
  });
  const { errors, warnings } = validateConfig(config);
  assert.deepEqual(errors, []);
  const text = warnings.join("\n");
  assert.match(text, /ALLOW_OTHER_PLAYERS/);
  assert.match(text, /AUTH_PASSWORD is empty/);
  assert.match(text, /WANDER_RADIUS/);
});

test("authentication mode and AFK style are validated", () => {
  const config = loadConfig({
    ...BASE,
    MC_AUTH: "password",
    AFK_STYLE: "dance",
  });
  const text = validateConfig(config).errors.join("\n");
  assert.match(text, /MC_AUTH/);
  assert.match(text, /AFK_STYLE/);
});

test("the reconnect cap can never be below the base delay", () => {
  const config = loadConfig({
    ...BASE,
    RECONNECT_MS: "60000",
    RECONNECT_MAX_MS: "1000",
  });
  assert.equal(config.reconnect.maxMs, 60000);
});

test("custom messages override the defaults", () => {
  const config = loadConfig({ ...BASE, STATUS_MESSAGE: "Up {seconds}s" });
  assert.equal(config.messages.STATUS_MESSAGE, "Up {seconds}s");
  assert.match(config.messages.BLACKLIST_MESSAGE, /not allowed/);
});

const examplePath = path.join(__dirname, "..", ".env.example");

test(".env.example is generated from the defaults", () => {
  const expected = buildEnvExample(MESSAGES);
  const actual = fs.readFileSync(examplePath, "utf8");
  assert.equal(
    actual,
    expected,
    ".env.example is out of date; run `npm run setup --migrate` or regenerate it",
  );
});

test("every customizable message is documented in the example", () => {
  const example = fs.readFileSync(examplePath, "utf8");
  for (const key of Object.keys(MESSAGES))
    assert.match(example, new RegExp(`^${key}=`, "m"), `${key} is missing`);
});

test("the example ships safe defaults", () => {
  const example = fs.readFileSync(examplePath, "utf8");
  assert.match(example, /^ALLOW_OTHER_PLAYERS=false$/m);
  assert.match(example, /^AUTH_PASSWORD=$/m);
  assert.match(example, /^MASTER_USERNAME=$/m);
});

function tempEnv(contents = 'MC_HOST="localhost"\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afk-env-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, contents, "utf8");
  return { dir, envPath };
}

test("values are serialized the way dotenv reads them back", () => {
  assert.equal(serializeValue(true), "true");
  assert.equal(serializeValue(25565), "25565");
  assert.equal(serializeValue('he said "hi"'), '"he said \\"hi\\""');
});

test("saving replaces an existing key in place", () => {
  const { dir, envPath } = tempEnv('MC_HOST="localhost"\nMASTERS=""\n');
  saveEnvValue(envPath, "MASTERS", "helper,other");
  const values = readEnvValues(envPath);
  assert.equal(values.MASTERS, "helper,other");
  assert.equal(values.MC_HOST, "localhost");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("saving appends a new key and leaves no temp file behind", () => {
  const { dir, envPath } = tempEnv();
  saveEnvValue(envPath, "ALLOW_OTHER_PLAYERS", true);
  const contents = fs.readFileSync(envPath, "utf8");
  assert.match(contents, /ALLOW_OTHER_PLAYERS=true/);
  assert.deepEqual(
    fs.readdirSync(dir).filter((file) => file.endsWith(".tmp")),
    [],
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("special characters are written safely", () => {
  const { dir, envPath } = tempEnv();
  saveEnvValue(envPath, "BLACKLIST_MESSAGE", "a $& b {player}");
  assert.equal(readEnvValues(envPath).BLACKLIST_MESSAGE, "a $& b {player}");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("saving to a missing .env fails loudly", () => {
  assert.throws(
    () => saveEnvValue("/nonexistent/.env", "KEY", "value"),
    /not found/,
  );
});

test("migration only adds missing keys", () => {
  const { dir, envPath } = tempEnv(
    'MC_HOST="localhost"\nSTATUS_MESSAGE="custom"\n',
  );
  const added = migrateEnvFile({
    envPath,
    messages: { STATUS_MESSAGE: "default", POS_MESSAGE: "pos {x}" },
    logger: { info() {}, warn() {} },
  });
  const values = readEnvValues(envPath);
  assert.deepEqual(added, ["POS_MESSAGE"]);
  assert.equal(
    values.STATUS_MESSAGE,
    "custom",
    "existing values are preserved",
  );
  assert.equal(values.POS_MESSAGE, "pos {x}");
  fs.rmSync(dir, { recursive: true, force: true });
});
