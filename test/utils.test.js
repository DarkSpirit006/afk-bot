// helpers, rate limiting, command parsing, permissions, chat formatting

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  format,
  normalizeMessage,
  normalizeName,
  parseBoolean,
  parseList,
  redact,
  seconds,
  USERNAME,
} = require("../src/utils/helpers");
const {
  isKnownPlayer,
  nameForUuid,
  parseChatAuthor,
  resolveSender,
  teleportType,
} = require("../src/chat/format");
const { createPermissions } = require("../src/permissions/permissions");
const { createRateLimit } = require("../src/utils/rate-limit");
const { parseCommand } = require("../src/commands/parser");
const { parseServerAddress } = require("../src/utils/server-address");

test("format replaces every placeholder", () => {
  assert.equal(
    format("{player} came to {x} {y} {z}", { player: "Bob", x: 1, y: 2, z: 3 }),
    "Bob came to 1 2 3",
  );
  assert.equal(format("no placeholders"), "no placeholders");
  assert.equal(format("{missing} stays", {}), "{missing} stays");
});

test("messages are normalized and colour codes removed", () => {
  assert.equal(normalizeMessage("\u00a7aHello   \u00a7lthere "), "Hello there");
  assert.equal(normalizeName("  BoB "), "bob");
});

test("boolean and list parsing is forgiving", () => {
  assert.equal(parseBoolean("YES", false), true);
  assert.equal(parseBoolean("nonsense", true), true);
  assert.equal(parseBoolean(undefined, false), false);
  assert.equal(parseBoolean("", true), true);
  assert.deepEqual([...parseList(" a, B ,,c ")], ["a", "b", "c"]);
});

test("secrets are redacted from log lines", () => {
  assert.equal(redact("password=hunter2", ["hunter2"]), "password=[redacted]");
  assert.equal(redact("nothing here", []), "nothing here");
});

test("usernames and small helpers behave", () => {
  assert.equal(USERNAME.test("AFK_Bot"), true);
  assert.equal(USERNAME.test("ab"), false);
  assert.equal(USERNAME.test("has space"), false);
  assert.equal(seconds(2500), 2);
});

test("server addresses are parsed and validated", () => {
  assert.deepEqual(parseServerAddress("localhost"), {
    host: "localhost",
    port: 25565,
  });
  assert.deepEqual(parseServerAddress("example.org:25570"), {
    host: "example.org",
    port: 25570,
  });
  assert.deepEqual(parseServerAddress("[::1]:25565"), {
    host: "::1",
    port: 25565,
  });
  assert.throws(() => parseServerAddress(""), /must not be empty/);
  assert.throws(() => parseServerAddress("host:99999"), /optional port/);
});

test("the rate limiter allows a burst then blocks", () => {
  let clock = 0;
  const limit = createRateLimit({ limit: 2, windowMs: 1000, now: () => clock });
  assert.equal(limit.allow("bob"), true);
  assert.equal(limit.allow("bob"), true);
  assert.equal(limit.allow("bob"), false);
  assert.equal(limit.allow("alice"), true);
  clock += 1000;
  assert.equal(limit.allow("bob"), true);
  limit.reset();
  assert.equal(limit.size(), 0);
});

test("parser honours the prefix and takes the last command", () => {
  assert.deepEqual(parseCommand("<Owner> !come 10 64 -20", "!", "Owner"), {
    name: "come",
    index: 8,
    args: ["10", "64", "-20"],
  });
  assert.equal(parseCommand("!unknown", "!", "Owner"), undefined);
  assert.equal(parseCommand("!statusx", "!", "Owner"), undefined);
  assert.deepEqual(parseCommand("Owner !status", "!", "Owner"), {
    name: "status",
    index: 6,
    args: [],
  });
});

test("commands inside server broadcasts are not executed", () => {
  // No resolved sender: the prefix must start the line.
  assert.equal(
    parseCommand("Server help: use !follow or !come", "!"),
    undefined,
  );
  assert.equal(parseCommand("Welcome! !stop is disabled", "!"), undefined);
});

test("a resolved sender may appear anywhere in the line", () => {
  assert.deepEqual(parseCommand("[VIP] Bob: !pos", "!", "Bob"), {
    name: "pos",
    index: 11,
    args: [],
  });
});

test("the prefix is configurable", () => {
  assert.deepEqual(parseCommand("Owner .status", ".", "Owner"), {
    name: "status",
    index: 6,
    args: [],
  });
  assert.equal(parseCommand("Owner !status", ".", "Owner"), undefined);
});

test("extra whitespace after the command is ignored", () => {
  assert.deepEqual(parseCommand("!come   1 2 3", "!", "Owner").args, [
    "1",
    "2",
    "3",
  ]);
});

const build = (allowOtherPlayers = false) =>
  createPermissions({
    primaryMaster: "Owner",
    masters: new Set(["helper"]),
    blacklist: new Set(["blocked"]),
    allowOtherPlayers,
  });

test("permissions are case insensitive", () => {
  const permissions = build();
  assert.equal(permissions.isMaster("OWNER"), true);
  assert.equal(permissions.isPrimaryMaster("Owner"), true);
  assert.equal(permissions.isMaster("Helper"), true);
  assert.equal(permissions.isPrimaryMaster("Helper"), false);
  assert.equal(permissions.canUseBot("Guest"), false);
  assert.equal(permissions.isBlacklisted("BLOCKED"), true);
  assert.equal(permissions.isBlacklisted("Helper"), false);
});

test("public access lets everyone use the bot", () => {
  assert.equal(build(true).canUseBot("Guest"), true);
  assert.equal(build(true).isMaster("Guest"), false);
});

test("listing helpers return plain arrays", () => {
  const permissions = build();
  assert.deepEqual(permissions.masters(), ["helper"]);
  assert.deepEqual(permissions.blacklisted(), ["blocked"]);
});

const players = {
  Owner: { uuid: "uuid-owner" },
  Bob: { uuid: "uuid-bob" },
  VIP: { uuid: "uuid-vip" },
};

test("sender resolution prefers the packet uuid", () => {
  assert.equal(
    resolveSender({
      players,
      uuid: "uuid-bob",
      text: "hello",
      cache: new Map(),
    }),
    "Bob",
  );
  assert.equal(
    nameForUuid(players, "UUID-OWNER".toLowerCase(), new Map()),
    "Owner",
  );
});

test("a rank prefix can never be mistaken for the sender", () => {
  // "[Rank] Name:" must give the player, not the rank tag.
  assert.equal(parseChatAuthor("[VIP] Bob: !master Bob"), "Bob");
  assert.equal(
    resolveSender({ players, text: "[VIP] Bob: !stop", cache: new Map() }),
    "Bob",
  );
  assert.equal(
    resolveSender({
      players,
      text: "[ADMIN] Bob » !bl Owner",
      cache: new Map(),
    }),
    "Bob",
  );
});

test("unknown or ambiguous authors are rejected", () => {
  // The parser may read "Server:" as an author, but resolveSender only trusts
  // names that are actually online, so broadcasts stay inert.
  assert.equal(
    resolveSender({
      players,
      text: "Server: welcome to the server",
      cache: new Map(),
    }),
    "",
  );
  assert.equal(parseChatAuthor("<unknownplayer> hi"), "unknownplayer");
  assert.equal(
    resolveSender({ players, text: "<ghost> !stop", cache: new Map() }),
    "",
    "a name that is not online must not be trusted",
  );
  assert.equal(resolveSender({ players, text: "", cache: new Map() }), "");
  assert.equal(
    resolveSender({
      players,
      uuid: "uuid-owner",
      text: "<Owner> !stop",
      cache: new Map(),
      self: "Owner",
    }),
    "",
    "the bot must ignore its own messages",
  );
});

test("a decorated chat line still resolves to the player", () => {
  // Servers with a chat plugin usually put tags, emoji or full width brackets
  // in front of the name, and send no sender uuid with the message.
  const cases = [
    "\u2b50 [Owner] Bob: !stop",
    "\u300cL\u300dBob \u00bb !stop",
    "(Mod) Bob: !stop",
    "Bob: !stop",
    "Bob says: !stop",
  ];
  for (const text of cases)
    assert.equal(
      resolveSender({ players, text, cache: new Map() }),
      "Bob",
      text,
    );
});

test("decoration alone never invents a sender", () => {
  // The name has to be at the very start of the message, not somewhere inside
  // it, or anyone could put a master's name in their own chat line.
  const cases = [
    "hey Bob: !stop",
    "someone said Bob: !stop",
    "Bob the builder: !stop",
  ];
  for (const text of cases)
    assert.equal(resolveSender({ players, text, cache: new Map() }), "");
});

test("known player lookups are case insensitive", () => {
  assert.equal(isKnownPlayer(players, "bob"), true);
  assert.equal(isKnownPlayer(players, "nobody"), false);
});

test("teleport request detection covers tpa and tpahere variants", () => {
  assert.equal(teleportType("Bob has requested to teleport to you"), "tpa");
  assert.equal(
    teleportType("Bob has requested that you teleport to them"),
    "tpahere",
  );
  assert.equal(teleportType("Bob wants to teleport to you"), "tpa");
  assert.equal(teleportType("Welcome to the server"), undefined);
});
