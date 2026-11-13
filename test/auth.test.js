// chat prompts, login dialogs and one-time codes

const assert = require("node:assert/strict");
const fixtures = require("./support/dialogs");
const nbt = require("prismarine-nbt");
const test = require("node:test");
const {
  createDialogAuth,
  describeDialog,
  expandTemplate,
} = require("../src/auth/dialogs");
const { EventEmitter } = require("node:events");
const { createAuthMe } = require("../src/auth/authme");
const { decodeBase32, generateTotp } = require("../src/utils/totp");
const { memoryLogger } = require("./support/fakes");

function setupChat({ maxAttempts = 3, retryMs = 5000, password = "hunter2" } = {}) {
  const sent = [];
  const scheduled = [];
  let clock = 0;
  const logger = { info() {}, warn() {}, error() {} };
  const auth = createAuthMe({
    getBot: () => ({ chat: (text) => sent.push(text) }),
    password,
    maxAttempts,
    retryMs,
    logger,
    now: () => clock,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    cancel: () => {},
  });
  return {
    auth,
    sent,
    scheduled,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("ordinary chat text never triggers authentication", () => {
  const { auth, sent } = setupChat();
  // A player asking about the password must not make the bot send it.
  assert.equal(
    auth.inspect("<Bob> does anyone know the login password?"),
    false,
  );
  assert.equal(
    auth.inspect("someone said the register password is public"),
    false,
  );
  assert.equal(auth.inspect("Welcome to the server, have fun"), false);
  assert.deepEqual(sent, []);
});

test("login and register prompts are answered once", () => {
  const { auth, sent } = setupChat();
  assert.equal(auth.inspect("Please login with /login <password>"), true);
  assert.deepEqual(sent, ["/login hunter2"]);
  assert.equal(auth.attempts(), 1);

  const second = setupChat();
  assert.equal(
    second.auth.inspect("Please register with /register <password> <password>"),
    true,
  );
  assert.deepEqual(second.sent, ["/register hunter2 hunter2"]);
});

test("already registered accounts fall back to login", () => {
  const { auth, sent } = setupChat();
  auth.inspect("This account is already registered, use /login");
  assert.deepEqual(sent, ["/login hunter2"]);
});

test("a rejected attempt schedules one retry and then gives up", () => {
  const { auth, sent, scheduled, advance } = setupChat({
    maxAttempts: 2,
    retryMs: 1000,
  });
  auth.inspect("Please login with /login <password>");
  assert.equal(sent.length, 1);

  auth.inspect("Wrong password!");
  assert.equal(scheduled.length, 1, "a retry should be scheduled");
  advance(1000);
  scheduled[0].fn();
  assert.equal(sent.length, 2);
  assert.equal(auth.attempts(), 2);

  auth.inspect("Wrong password!");
  advance(1000);
  scheduled[1].fn();
  assert.equal(auth.gaveUp(), true);
  assert.equal(sent.length, 2, "no further attempts after giving up");
});

test("the same prompt is not answered twice in a row", () => {
  const { auth, sent, advance } = setupChat();
  auth.inspect("Please login with /login <password>");
  auth.inspect("Please login with /login <password>");
  assert.equal(sent.length, 1);
  advance(5000);
  auth.inspect("Please login with /login <password>");
  assert.equal(sent.length, 2);
});

test("without a password nothing is sent", () => {
  const { auth, sent } = setupChat({ password: "" });
  assert.equal(auth.inspect("Please login with /login <password>"), false);
  assert.deepEqual(sent, []);
});

const TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function fakeClient() {
  const client = new EventEmitter();
  client.state = "configuration";
  client.writes = [];
  client.write = (name, params) => client.writes.push({ name, params });
  // Dialog answers are raw bytes, so they land here instead of in writes.
  client.rawWrites = [];
  client.writeRaw = (buffer) => client.rawWrites.push(buffer);
  return client;
}

function setupDialogs(overrides = {}) {
  const client = overrides.client || fakeClient();
  // Unit tests talk to the client directly, so pretend we are in-game.
  if (!overrides.client) client.state = "play";
  const logger = overrides.logger || memoryLogger();
  const bot = { sent: [], entity: {}, chat: (text) => bot.sent.push(text) };
  const auth = createDialogAuth({
    getBot: () => bot,
    getClient: () => client,
    password: "hunter2",
    maxAttempts: 3,
    retryMs: 5000,
    logger,
    nbt,
    ...overrides,
  });
  auth.attach(client);
  return { auth, client, bot, logger };
}

const answerOf = (client) =>
  fixtures.decodeClickAction(client.rawWrites.at(-1));

test("pre-join login dialog is answered with a click action", () => {
  const { auth, client, logger } = setupDialogs();
  const result = auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });

  assert.equal(result.status, "submitted");
  assert.equal(client.rawWrites.length, 1);
  const answer = answerOf(client);
  assert.equal(answer.id, "authme:prejoin-login/submit");
  assert.deepEqual(answer.values, { password: "hunter2" });

  assert.match(logger.text(), /Answered the login dialog \(attempt 1\/3\)/);
  assert.equal(
    logger.text().includes("hunter2"),
    false,
    "password must never be logged",
  );
});

test("recovery and cancel buttons do not confuse the parser", () => {
  const description = describeDialog(fixtures.PRE_JOIN_LOGIN(), nbt);
  assert.equal(description.kind, "login");
  assert.equal(description.submitId, "authme:prejoin-login/submit");
  assert.equal(description.cancelId, "authme:prejoin-login/cancel");
  assert.deepEqual(description.inputKeys, ["password"]);
});

test("a dialog wrapped in a registry holder is unwrapped", () => {
  const { auth, client } = setupDialogs();
  const holder = { data: fixtures.PRE_JOIN_LOGIN() };
  assert.equal(auth.handle({ dialog: holder }).status, "submitted");
  assert.equal(answerOf(client).id, "authme:prejoin-login/submit");
});

test("register dialog fills password and confirm", () => {
  const { auth, client } = setupDialogs();
  const result = auth.handle({ dialog: fixtures.PRE_JOIN_REGISTER() });
  assert.equal(result.status, "submitted");
  assert.equal(answerOf(client).id, "authme:prejoin-register/submit");
  assert.deepEqual(answerOf(client).values, {
    password: "hunter2",
    confirm: "hunter2",
  });
});

test("email registration fills email and confirm", () => {
  const { auth, client } = setupDialogs({ email: "bot@example.org" });
  const result = auth.handle({
    dialog: fixtures.PRE_JOIN_REGISTER(["email", "confirm"]),
  });
  assert.equal(result.status, "submitted");
  assert.deepEqual(answerOf(client).values, {
    email: "bot@example.org",
    confirm: "bot@example.org",
  });
});

test("missing email is skipped, not submitted", () => {
  const { auth, client, logger } = setupDialogs({ email: "" });
  const result = auth.handle({
    dialog: fixtures.PRE_JOIN_REGISTER(["email", "password"]),
  });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /AUTH_EMAIL/);
  assert.equal(
    client.rawWrites.length,
    0,
    "an invalid registration must not be sent",
  );
  assert.match(logger.text(), /Cannot answer the register dialog/);
});

test("a recovery dialog needs AUTH_EMAIL", () => {
  const withEmail = setupDialogs({ email: "bot@example.org" });
  assert.equal(
    withEmail.auth.handle({ dialog: fixtures.PRE_JOIN_RECOVERY() }).status,
    "submitted",
  );
  assert.deepEqual(answerOf(withEmail.client).values, {
    email: "bot@example.org",
  });

  const withoutEmail = setupDialogs({ email: "" });
  const result = withoutEmail.auth.handle({
    dialog: fixtures.PRE_JOIN_RECOVERY(),
  });
  assert.equal(result.status, "skipped");
  assert.equal(withoutEmail.client.rawWrites.length, 0);
});

test("no password configured means no dialog answer at all", () => {
  const { auth, client } = setupDialogs({ password: "" });
  const result = auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /AUTH_PASSWORD/);
  assert.equal(client.rawWrites.length, 0);
});

test("notices and dialogs without a submit action are ignored", () => {
  const { auth, client, logger } = setupDialogs();
  const result = auth.handle({ dialog: fixtures.NOTICE_DIALOG() });
  assert.equal(result.status, "ignored");
  assert.equal(client.rawWrites.length, 0);
  assert.match(logger.text(), /without a submit action/);
});

test("the attempt limit stops a wrong-password loop", () => {
  const { auth, client, logger } = setupDialogs({ retryMs: 0 });
  for (let attempt = 0; attempt < 3; attempt += 1)
    assert.equal(
      auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() }).status,
      "submitted",
    );
  assert.equal(client.rawWrites.length, 3);

  const fourth = auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(fourth.status, "gave-up");
  assert.equal(client.rawWrites.length, 3, "no further attempts after the limit");
  assert.equal(auth.gaveUp(), true);
  assert.match(logger.text(), /Gave up after 3 dialog attempts/);
});

test("a re-sent dialog is throttled before another attempt", () => {
  let clock = 0;
  const { auth, client } = setupDialogs({ now: () => clock });
  auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(client.rawWrites.length, 1);

  const early = auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(early.status, "throttled");
  assert.equal(client.rawWrites.length, 1);

  clock += 5000;
  assert.equal(
    auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() }).status,
    "submitted",
  );
});

test("post-join dialog is answered with a command", () => {
  const { auth, client, bot } = setupDialogs({ retryMs: 0 });
  const result = auth.handle({ dialog: fixtures.POST_JOIN_LOGIN() });
  assert.equal(result.status, "submitted");
  assert.deepEqual(bot.sent, ["/login hunter2"]);
  assert.equal(client.rawWrites.length, 0);

  bot.sent.length = 0;
  auth.handle({ dialog: fixtures.POST_JOIN_REGISTER() });
  assert.deepEqual(bot.sent, ["/register hunter2 hunter2"]);
});

test("2fa dialog gets a generated code", () => {
  const { auth, bot, logger } = setupDialogs({
    totpSecret: TOTP_SECRET,
    now: () => 59 * 1000,
  });
  const result = auth.handle({ dialog: fixtures.POST_JOIN_TOTP() });
  assert.equal(result.status, "submitted");
  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0], /^\/2fa code \d{6}$/);
  assert.equal(bot.sent[0].endsWith("287082"), true, "RFC 6238 code for t=59s");
  assert.equal(logger.text().includes("287082"), false, "codes are not logged");
});

test("a two-factor dialog without a secret is skipped", () => {
  const { auth, bot } = setupDialogs({ totpSecret: "" });
  assert.equal(
    auth.handle({ dialog: fixtures.POST_JOIN_TOTP() }).status,
    "skipped",
  );
  assert.deepEqual(bot.sent, []);
});

test("an invalid TOTP secret is reported and skipped", () => {
  const { auth, bot, logger } = setupDialogs({ totpSecret: "not base32!" });
  assert.equal(
    auth.handle({ dialog: fixtures.POST_JOIN_TOTP() }).status,
    "skipped",
  );
  assert.match(logger.text(), /one-time code/);
  assert.deepEqual(bot.sent, []);
});

test("a new connection resets the attempt counter", () => {
  const { auth, client } = setupDialogs({ retryMs: 0 });
  for (let attempt = 0; attempt < 3; attempt += 1)
    auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(auth.attempts(), 3);

  client.emit("state", "configuration");
  assert.equal(auth.attempts(), 0);
  assert.equal(
    auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() }).status,
    "submitted",
  );
});

test("packets arriving on the client are handled automatically", () => {
  const { client } = setupDialogs();
  client.emit("show_dialog", { dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(client.rawWrites.length, 1);
  assert.equal(answerOf(client).id, "authme:prejoin-login/submit");
});

test("chat auth stays quiet while a dialog is open", () => {
  const clock = 0;
  const { auth, client } = setupDialogs({ now: () => clock });
  assert.equal(auth.isBusy(), false);
  auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() });
  assert.equal(auth.isBusy(), true);
  client.emit("clear_dialog");
  assert.equal(auth.isBusy(), false);
});

test("a broken packet cannot crash the bot", () => {
  const { client } = setupDialogs();
  client.emit("show_dialog", { dialog: undefined });
  client.emit("show_dialog", undefined);
  assert.equal(client.rawWrites.length, 0);
});

test("template expansion is safe for missing values", () => {
  assert.equal(
    expandTemplate("login $(password)", { password: "x" }),
    "login x",
  );
  assert.equal(expandTemplate("login $(password)", {}), "login ");
  assert.equal(expandTemplate("", { password: "x" }), "");
});

test("a failed command send is retried until it works", () => {
  const timers = [];
  let chats = 0;
  const bot = {
    sent: [],
    entity: {},
    chat(text) {
      chats += 1;
      if (chats === 1) throw new Error("socket busy");
      bot.sent.push(text);
    },
  };
  const auth = createDialogAuth({
    getBot: () => bot,
    getClient: () => ({ state: "play" }),
    password: "hunter2",
    logger: memoryLogger(),
    nbt,
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: () => {},
  });
  const result = auth.handle({ dialog: fixtures.POST_JOIN_LOGIN() });
  assert.equal(result.status, "failed");
  assert.equal(timers.length, 1);
  timers[0]();
  assert.deepEqual(bot.sent, ["/login hunter2"]);
});

test("a command sent before the bot joins is queued and flushed", () => {
  const client = fakeClient();
  // Still in configuration: mineflayer would drop anything sent now.
  const bot = { sent: [], chat: (text) => bot.sent.push(text) };
  const auth = createDialogAuth({
    getBot: () => bot,
    getClient: () => client,
    password: "hunter2",
    logger: memoryLogger(),
    nbt,
  });
  auth.attach(client);

  auth.handle({ dialog: fixtures.POST_JOIN_LOGIN() });
  assert.deepEqual(bot.sent, [], "chat is dropped before the play state");
  assert.deepEqual(auth.queued(), ["/login hunter2"]);

  client.state = "play";
  client.emit("state", "play");
  assert.deepEqual(bot.sent, ["/login hunter2"]);
  assert.deepEqual(auth.queued(), []);
});

test("dialog auth can be turned off", () => {
  const { auth, client } = setupDialogs({ enabled: false });
  assert.equal(
    auth.handle({ dialog: fixtures.PRE_JOIN_LOGIN() }).status,
    "disabled",
  );
  assert.equal(client.rawWrites.length, 0);
});

// RFC 6238 appendix B test vectors (secret "12345678901234567890").
const SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 secrets are decoded", () => {
  assert.equal(decodeBase32("GEZDGNBV").toString("utf8"), "12345");
  assert.equal(decodeBase32("GEZDGNBVGY3TQOJQ").toString("utf8"), "1234567890");
  assert.deepEqual(decodeBase32("gezd gnbv"), decodeBase32("GEZDGNBV"));
  assert.equal(decodeBase32("GEZDGNBV====").toString("utf8"), "12345");
  assert.throws(() => decodeBase32("not-base32!"), /base32/);
  assert.throws(() => decodeBase32(""), /empty/);
});

test("codes match the RFC 6238 vectors", () => {
  assert.equal(
    generateTotp({ secret: SHA1_SECRET, timestamp: 59 * 1000 }),
    "287082",
  );
  assert.equal(
    generateTotp({ secret: SHA1_SECRET, timestamp: 1111111109 * 1000 }),
    "081804",
  );
  assert.equal(
    generateTotp({ secret: SHA1_SECRET, timestamp: 1234567890 * 1000 }),
    "005924",
  );
  assert.equal(
    generateTotp({ secret: SHA1_SECRET, timestamp: 2000000000 * 1000 }),
    "279037",
  );
});

test("codes rotate every 30 seconds and stay six digits", () => {
  const inside = generateTotp({ secret: SHA1_SECRET, timestamp: 60_000 });
  const sameWindow = generateTotp({ secret: SHA1_SECRET, timestamp: 89_999 });
  const nextWindow = generateTotp({ secret: SHA1_SECRET, timestamp: 90_000 });
  assert.equal(inside, sameWindow);
  assert.notEqual(inside, nextWindow);
  for (let step = 0; step < 20; step += 1) {
    const code = generateTotp({
      secret: SHA1_SECRET,
      timestamp: step * 30_000,
    });
    assert.match(code, /^\d{6}$/);
  }
});

test("SHA-256 codes are supported too", () => {
  const code = generateTotp({
    secret: SHA1_SECRET,
    timestamp: 59 * 1000,
    algorithm: "sha256",
    digits: 8,
  });
  assert.match(code, /^\d{8}$/);
});
