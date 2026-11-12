const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanup,
  createController,
  emitChat,
  emitServer,
} = require("./support/fakes");
const { readEnvValues } = require("../src/services/env-store");

function harness(t, options = {}) {
  const context = createController(options);
  t.after(() => {
    context.controller.shutdown();
    cleanup(context.tmpDir);
  });
  return context;
}

const said = (bot) => bot.sent.join("\n");

test("a rank prefix cannot be used to impersonate a master", (t) => {
  const { bot, config } = harness(t);
  // Bob's own uuid, but the server renders chat as "[Owner] Bob: ...".
  emitChat(bot, "[Owner] Bob: !master Bob", { uuid: "uuid-bob" });
  assert.match(said(bot), /only a master/);
  assert.equal(config.masters.size, 0);
});

test("a rank tag cannot be used as a name", (t) => {
  const { bot, config } = harness(t);
  emitChat(bot, "[Owner] VIP: !stop", { uuid: "uuid-vip" });
  assert.match(said(bot), /only a master/);
  assert.equal(bot.quitReason, undefined);
  assert.equal(config.masters.size, 0);
});

test("text-only servers still resolve the real author", (t) => {
  const { bot } = harness(t);
  // No uuid available: "[VIP] Bob: !master Bob" must resolve to Bob, not VIP.
  emitChat(bot, "[VIP] Bob: !master Bob");
  assert.match(said(bot), /only a master/);
});

test("server broadcasts never run commands", (t) => {
  const { bot } = harness(t);
  emitServer(bot, "Server: use !stop to stop the bot");
  emitServer(bot, "<Owner> !stop", "chat");
  assert.equal(said(bot), "");
  assert.equal(bot.quitReason, undefined);
});

test("masters can be added and removed", (t) => {
  const { bot, config, envPath } = harness(t);
  emitChat(bot, "!master Bob", { uuid: "uuid-owner" });
  assert.match(said(bot), /is now a master/);
  assert.equal(config.masters.has("bob"), true);
  assert.equal(readEnvValues(envPath).MASTERS, "bob");

  emitChat(bot, "!rm master Bob", { uuid: "uuid-owner" });
  assert.match(said(bot), /no longer a master/);
  assert.equal(config.masters.has("bob"), false);

  emitChat(bot, "!rm master Owner", { uuid: "uuid-owner" });
  assert.match(said(bot), /cannot be removed/);
});

test("blacklist toggles on and off", (t) => {
  const { bot, config } = harness(t);
  emitChat(bot, "!bl VIP", { uuid: "uuid-owner" });
  assert.equal(config.blacklist.has("vip"), true);
  emitChat(bot, "!rmbl VIP", { uuid: "uuid-owner" });
  assert.equal(config.blacklist.has("vip"), false);
  emitChat(bot, "!bl Owner", { uuid: "uuid-owner" });
  assert.match(said(bot), /primary master cannot be blacklisted/);
});

test("blacklisted players get nothing", (t) => {
  const { bot } = harness(t, { env: { BLACKLIST: "bob" } });
  emitChat(bot, "!pos", { uuid: "uuid-bob" });
  assert.match(said(bot), /not allowed to use this bot/);
});

test("commands are rate limited per player", (t) => {
  const { bot } = harness(t, { env: { RATE_LIMIT_COUNT: "2" } });
  emitChat(bot, "!pos", { uuid: "uuid-owner" });
  emitChat(bot, "!pos", { uuid: "uuid-owner" });
  emitChat(bot, "!pos", { uuid: "uuid-owner" });
  assert.match(said(bot), /Slow down/);
});

test("status and position report live state", (t) => {
  const { bot } = harness(t);
  emitChat(bot, "!pos", { uuid: "uuid-owner" });
  assert.match(said(bot), /0 64 0/);
  emitChat(bot, "!health", { uuid: "uuid-owner" });
  assert.match(said(bot), /Health 20\/20, food 20\/20/);
  emitChat(bot, "!status", { uuid: "uuid-owner" });
  assert.match(said(bot), /Online for/);
});

test("!stop is restricted to the primary master", async (t) => {
  const { bot, controller } = harness(t);
  emitChat(bot, "!stop", { uuid: "uuid-bob" });
  assert.match(said(bot), /only a master/);
  assert.equal(bot.quitReason, undefined);

  emitChat(bot, "!stop", { uuid: "uuid-owner" });
  assert.match(said(bot), /Stopping AFK bot/);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bot.quitReason, "AFK bot shutting down");
  assert.equal(controller.exited, true);
});

test("!say is primary-master only and answers with the text", (t) => {
  const { bot } = harness(t);
  emitChat(bot, "!say hello there", { uuid: "uuid-bob" });
  assert.match(said(bot), /only a master/);
  emitChat(bot, "!say hello there", { uuid: "uuid-owner" });
  assert.match(said(bot), /hello there/);
});

test("player chat can never trigger authentication", (t) => {
  const { bot } = harness(t, { env: { AUTH_PASSWORD: "hunter2" } });
  emitChat(bot, "does anyone know the login password?", { uuid: "uuid-bob" });
  emitChat(bot, "[Owner] Bob: please login with /login <password>", {
    uuid: "uuid-bob",
  });
  assert.equal(said(bot).includes("hunter2"), false);
});

test("server login prompts are answered", (t) => {
  const { bot } = harness(t, { env: { AUTH_PASSWORD: "hunter2" } });
  emitServer(bot, "Please login with /login <password>");
  assert.match(said(bot), /\/login hunter2/);
});

test("teleport requests need approval and can be accepted", (t) => {
  const { bot } = harness(t);
  emitServer(bot, "Bob has requested to teleport to you");
  assert.match(said(bot), /needs master approval/);
  emitChat(bot, "!y", { uuid: "uuid-owner" });
  assert.match(said(bot), /\/tpaccept/);
});

test("teleport requests auto-accept for masters", (t) => {
  const { bot } = harness(t);
  emitServer(bot, "Owner has requested to teleport to you");
  assert.match(said(bot), /Accepted tpa from Owner/);
});

test("navigation commands respect the feature flag", (t) => {
  const { bot } = harness(t, { env: { FEATURE_NAVIGATION: "false" } });
  emitChat(bot, "!come 1 2 3", { uuid: "uuid-owner" });
  assert.match(said(bot), /Navigation is disabled/);
});

test("come reports bad coordinates and unknown players", (t) => {
  const { bot } = harness(t);
  emitChat(bot, "!come 1 2", { uuid: "uuid-owner" });
  assert.match(said(bot), /out of range/);
  emitChat(bot, "!come Ghost", { uuid: "uuid-owner" });
  assert.match(said(bot), /cannot see you/);
});

test("help is split into short lines", (t) => {
  const { bot } = harness(t);
  emitChat(bot, "!cmd", { uuid: "uuid-bob" });
  const lines = bot.sent.filter((line) => line.includes("!"));
  assert.ok(lines.length >= 1);
  for (const line of lines)
    assert.ok(line.length < 256, "lines must stay short");
  assert.equal(
    said(bot).includes("!master"),
    false,
    "masters-only help is hidden",
  );
});

test("unknown commands are ignored quietly", (t) => {
  const { bot } = harness(t);
  emitChat(bot, "!notacommand", { uuid: "uuid-owner" });
  emitChat(bot, "just chatting", { uuid: "uuid-owner" });
  assert.equal(said(bot), "");
});
