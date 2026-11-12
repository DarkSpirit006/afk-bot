// afk movement, chat queue, reconnects, teleports, watchdog, health endpoint

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const test = require("node:test");
const {
  createReconnect,
  isPermanentReason,
} = require("../src/services/reconnect");
const { createAfk } = require("../src/services/afk");
const { createChatQueue } = require("../src/services/chat-queue");
const { createFakeBot, createPosition } = require("./support/fakes");
const { createHealthServer } = require("../src/services/health");
const { createTeleport } = require("../src/services/teleport");
const { createWatchdog } = require("../src/services/watchdog");

function setupAfk(options = {}) {
  const bot = options.bot || createFakeBot();
  const afk = createAfk({
    getBot: () => bot,
    intervalMs: 60000,
    style: "look",
    minHealth: 8,
    wanderRadius: 16,
    enabled: true,
    logger: { info() {}, debug() {}, warn() {} },
    random: () => 0.9,
    getOrigin: () => createPosition(0, 64, 0),
    ...options,
  });
  return { afk, bot };
}

test("look style turns the head and swings an arm", () => {
  const { afk, bot } = setupAfk();
  afk.runOnce();
  assert.ok(bot.controls.includes("look"));
  assert.ok(bot.controls.includes("swing"));
  assert.equal(
    bot.controls.some((control) => control.startsWith("forward")),
    false,
    "look style must never walk",
  );
});

test("movement is skipped when the bot is hurt", () => {
  const bot = createFakeBot();
  bot.health = 3;
  const { afk } = setupAfk({ bot, style: "walk" });
  afk.runOnce();
  assert.deepEqual(bot.controls, ["clear"]);
});

test("movement is skipped over hazards and air", () => {
  const bot = createFakeBot();
  bot.blockAt = () => ({ name: "lava", boundingBox: "empty" });
  const { afk } = setupAfk({ bot, style: "walk" });
  afk.runOnce();
  assert.deepEqual(bot.controls, ["clear"]);

  const floating = createFakeBot();
  floating.blockAt = () => ({ name: "air", boundingBox: "empty" });
  const second = setupAfk({ bot: floating, style: "walk" });
  second.afk.runOnce();
  assert.deepEqual(floating.controls, ["clear"]);
});

test("movement is skipped in water and lava", () => {
  const bot = createFakeBot();
  bot.entity.isInWater = true;
  const { afk } = setupAfk({ bot, style: "walk" });
  afk.runOnce();
  assert.deepEqual(bot.controls, ["clear"]);
});

test("walk style moves only inside the wander radius", () => {
  const inside = createFakeBot({ position: createPosition(2, 64, 2) });
  const afk = setupAfk({ bot: inside, style: "walk" }).afk;
  afk.runOnce();
  assert.ok(inside.controls.includes("forward:true"));

  const distant = createFakeBot({ position: createPosition(40, 64, 0) });
  const second = setupAfk({ bot: distant, style: "walk" }).afk;
  second.runOnce();
  assert.deepEqual(distant.controls, ["clear"]);
});

test("starting twice is a no-op and stop clears the timers", () => {
  const { afk, bot } = setupAfk();
  assert.equal(afk.start(), true);
  assert.equal(afk.start(), false);
  afk.stop();
  assert.ok(bot.controls.includes("clear"));
});

function setupQueue(options = {}) {
  const sent = [];
  const timers = [];
  let clock = 0;
  const warnings = [];
  const queue = createChatQueue({
    send: (text) => sent.push(text),
    minIntervalMs: 1000,
    maxQueue: 3,
    logger: { warn: (category, message) => warnings.push(message) },
    now: () => clock,
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    cancel: () => {},
    ...options,
  });
  return {
    queue,
    sent,
    timers,
    warnings,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("first message is immediate, the rest are throttled", () => {
  const { queue, sent, timers, advance } = setupQueue();
  queue.push("one");
  queue.push("two");
  queue.push("three");
  assert.deepEqual(sent, ["one"]);
  assert.equal(queue.size(), 2);

  // The queue re-arms itself while the throttle window is still open.
  advance(500);
  timers.at(-1).fn();
  assert.deepEqual(sent, ["one"]);

  advance(500);
  timers.at(-1).fn();
  assert.deepEqual(sent, ["one", "two"]);
  assert.equal(queue.size(), 1);
});

test("ordering is preserved and the queue drains completely", () => {
  const { queue, sent, timers, advance } = setupQueue();
  queue.push("a");
  queue.push("b");
  queue.push("c");
  for (let step = 0; step < 5; step += 1) {
    advance(1000);
    const timer = timers.at(-1);
    if (timer && !timer.done) {
      timer.done = true;
      timer.fn();
    }
  }
  assert.deepEqual(sent, ["a", "b", "c"]);
  assert.equal(queue.size(), 0);
});

test("a full queue drops new messages with a warning", () => {
  const { queue, sent, warnings } = setupQueue();
  for (const text of ["a", "b", "c", "d", "e"]) queue.push(text);
  assert.deepEqual(sent, ["a"]);
  assert.equal(queue.size(), 3);
  assert.match(warnings.join("\n"), /queue is full/);
});

test("empty messages are ignored and stop clears the queue", () => {
  const { queue, sent } = setupQueue();
  assert.equal(queue.push("   "), false);
  queue.push("kept");
  assert.equal(queue.push("later"), true);
  queue.stop();
  assert.equal(queue.size(), 0);
  assert.deepEqual(sent, ["kept"]);
});

test("a failing send is reported instead of thrown", () => {
  const warnings = [];
  const queue = createChatQueue({
    send: () => {
      throw new Error("socket closed");
    },
    minIntervalMs: 0,
    logger: { warn: (category, message) => warnings.push(message) },
  });
  queue.push("hello");
  assert.match(warnings.join("\n"), /socket closed/);
});

function setupReconnect({ maxAttempts = 0 } = {}) {
  const timers = [];
  let connects = 0;
  const logged = [];
  const reconnect = createReconnect({
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    maxAttempts,
    jitter: 0,
    connect: () => connects++,
    logger: {
      info: (category, message) => logged.push(message),
      error: (category, message) => logged.push(`error: ${message}`),
    },
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    cancel: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true;
    },
  });
  return {
    reconnect,
    timers,
    logged,
    connects: () => connects,
    fire: () => {
      const timer = timers
        .filter((entry) => !entry.fired && !entry.cancelled)
        .pop();
      timer.fired = true;
      timer.fn();
    },
  };
}

test("reconnects coalesce duplicate schedules", () => {
  const { reconnect, timers } = setupReconnect();
  reconnect.schedule();
  reconnect.schedule();
  assert.equal(timers.length, 1);
});

test("the delay grows exponentially and is capped", () => {
  const { reconnect, timers } = setupReconnect();
  const delays = [];
  for (let index = 0; index < 6; index += 1) {
    assert.equal(reconnect.schedule(), true);
    const timer = timers.at(-1);
    delays.push(timer.ms);
    timer.fn();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000, 8000]);
});

test("jitter keeps the delay inside the configured band", () => {
  const build = (random) =>
    createReconnect({
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      jitter: 0.5,
      connect() {},
      logger: { info() {} },
      random,
      schedule: () => 1,
      cancel: () => {},
    });
  const low = build(() => 0);
  const high = build(() => 1);
  assert.equal(low.nextDelayMs(), 1000, "clamped to the base delay");
  assert.equal(high.nextDelayMs(), 1500, "base + 50% jitter");
  low.schedule();
  high.schedule();
  assert.equal(low.nextDelayMs(), 1000);
  assert.equal(high.nextDelayMs(), 3000);
});

test("permanent kicks stop the reconnect loop", () => {
  assert.equal(isPermanentReason("You are banned from this server"), true);
  assert.equal(
    isPermanentReason("You are not whitelisted on this server"),
    true,
  );
  assert.equal(isPermanentReason("Server is full"), false);

  const { reconnect, timers, logged } = setupReconnect();
  assert.equal(reconnect.schedule("You are banned from this server"), false);
  assert.equal(timers.length, 0);
  assert.equal(reconnect.gaveUp(), true);
  assert.match(logged.join("\n"), /permanently/);
});

test("maxAttempts bounds the number of retries", () => {
  const { reconnect, timers } = setupReconnect({ maxAttempts: 2 });
  assert.equal(reconnect.schedule(), true);
  assert.equal(reconnect.schedule(), false, "second call coalesces");
  timers[0].fn();
  assert.equal(reconnect.schedule(), true);
  timers[1].fn();
  assert.equal(reconnect.schedule(), false);
  assert.equal(reconnect.gaveUp(), true);
});

test("reset clears the attempt counter", () => {
  const { reconnect, timers } = setupReconnect();
  reconnect.schedule();
  timers[0].fn();
  assert.equal(reconnect.attempts(), 1);
  reconnect.reset();
  assert.equal(reconnect.attempts(), 0);
  assert.equal(reconnect.gaveUp(), false);
});

test("cancel drops a pending reconnect", () => {
  const { reconnect, timers, connects } = setupReconnect();
  reconnect.schedule();
  reconnect.cancel();
  assert.equal(timers[0].cancelled, true);
  assert.equal(connects(), 0);
});

function setupTeleport({ maxPending = 3 } = {}) {
  const sent = [];
  const events = [];
  const timers = [];
  let clock = 0;
  const teleport = createTeleport({
    getBot: () => ({ chat: (text) => sent.push(text) }),
    logger: { info() {}, warn() {} },
    approvalMs: 30000,
    cooldownMs: 5000,
    maxPending,
    now: () => clock,
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    cancel: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true;
    },
    onEvent: (event) => events.push(event),
  });
  return {
    teleport,
    sent,
    events,
    timers,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("requests are queued with ids instead of being dropped", () => {
  const { teleport } = setupTeleport();
  const first = teleport.request("Bob", "tpa");
  const second = teleport.request("Alice", "tpahere");
  assert.equal(first.status, "pending");
  assert.equal(first.request.id, 1);
  assert.equal(second.request.id, 2);
  assert.equal(teleport.size(), 2);
});

test("a duplicate request from the same player is ignored", () => {
  const { teleport } = setupTeleport();
  teleport.request("Bob", "tpa");
  assert.equal(teleport.request("Bob", "tpa").status, "duplicate");
  assert.equal(teleport.size(), 1);
});

test("the queue is bounded", () => {
  const { teleport } = setupTeleport({ maxPending: 2 });
  teleport.request("A", "tpa");
  teleport.request("B", "tpa");
  assert.equal(teleport.request("C", "tpa").status, "full");
});

test("accepting sends /tpaccept and clears the timer", () => {
  const { teleport, sent, timers, events } = setupTeleport();
  teleport.request("Bob", "tpa");
  const result = teleport.reply(true);
  assert.equal(result.status, "accepted");
  assert.deepEqual(sent, ["/tpaccept"]);
  assert.equal(teleport.size(), 0);
  assert.equal(timers[0].cancelled, true);
  assert.equal(events.at(-1).type, "accepted");
});

test("a master can answer a specific request by id", () => {
  const { teleport, events } = setupTeleport();
  teleport.request("Bob", "tpa");
  teleport.request("Alice", "tpa");
  const result = teleport.reply(false, "2");
  assert.equal(result.request.sender, "Alice");
  assert.equal(events.at(-1).type, "rejected");
  assert.equal(teleport.size(), 1);
});

test("answering without a pending request reports it", () => {
  const { teleport, events } = setupTeleport();
  assert.equal(teleport.reply(true).status, "none");
  assert.equal(events.at(-1).type, "missing");
});

test("requests expire on their own", () => {
  const { teleport, timers, events } = setupTeleport();
  teleport.request("Bob", "tpa");
  timers[0].fn();
  assert.equal(teleport.size(), 0);
  assert.equal(events.at(-1).type, "expired");
});

test("auto-accept respects the cooldown", () => {
  const { teleport, sent, advance } = setupTeleport();
  assert.equal(teleport.acceptNow("Owner", "tpa").status, "accepted");
  assert.equal(teleport.acceptNow("Bob", "tpa").status, "cooldown");
  assert.equal(sent.length, 1);
  advance(5000);
  assert.equal(teleport.acceptNow("Bob", "tpa").status, "accepted");
});

test("a frozen connection is detected and cycled", () => {
  const bot = createFakeBot();
  let clock = 0;
  let stalls = 0;
  const watchdog = createWatchdog({
    getBot: () => bot,
    timeoutMs: 1000,
    checkIntervalMs: 100,
    logger: { warn() {} },
    now: () => clock,
    onStall: () => stalls++,
  });

  watchdog.check(); // records the first signature
  clock += 500;
  watchdog.check();
  assert.equal(stalls, 0);

  clock += 1000;
  watchdog.check();
  assert.equal(stalls, 1);
});

test("movement counts as activity", () => {
  const bot = createFakeBot();
  let clock = 0;
  let stalls = 0;
  const watchdog = createWatchdog({
    getBot: () => bot,
    timeoutMs: 1000,
    logger: { warn() {} },
    now: () => clock,
    onStall: () => stalls++,
  });

  watchdog.check();
  for (let step = 1; step <= 4; step += 1) {
    clock += 400;
    bot.entity.position.x += 1;
    watchdog.check();
  }
  assert.equal(stalls, 0);
});

test("touch() resets the timer", () => {
  const bot = createFakeBot();
  let clock = 0;
  let stalls = 0;
  const watchdog = createWatchdog({
    getBot: () => bot,
    timeoutMs: 1000,
    logger: { warn() {} },
    now: () => clock,
    onStall: () => stalls++,
  });

  watchdog.check();
  clock += 900;
  watchdog.touch();
  clock += 900;
  watchdog.check();
  assert.equal(stalls, 0);
  clock += 200;
  watchdog.check();
  assert.equal(stalls, 1);
});

test("a disabled watchdog does not start", () => {
  const watchdog = createWatchdog({
    getBot: () => createFakeBot(),
    timeoutMs: 0,
    logger: { warn() {} },
  });
  assert.equal(watchdog.start(), false);
  watchdog.stop();
});

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode, body: JSON.parse(body) }),
        );
      })
      .on("error", reject);
  });
}

test("the endpoint reports connected state", async () => {
  const port = await freePort();
  const health = createHealthServer({
    host: "127.0.0.1",
    port,
    logger: { info() {}, warn() {} },
    getState: () => ({ connected: true, username: "AFK_Bot" }),
  });
  await health.start();
  const response = await get(health.url());
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.username, "AFK_Bot");

  const missing = await get(`http://127.0.0.1:${port}/nope`).catch(
    () => undefined,
  );
  assert.equal(missing?.status, 404);
  await health.stop();
});

test("a disconnected bot returns 503", async () => {
  const port = await freePort();
  const health = createHealthServer({
    host: "127.0.0.1",
    port,
    logger: { info() {}, warn() {} },
    getState: () => ({ connected: false }),
  });
  await health.start();
  const response = await get(health.url());
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  await health.stop();
});

test("port 0 disables the endpoint", async () => {
  const health = createHealthServer({ port: 0, getState: () => ({}) });
  assert.equal(await health.start(), false);
  assert.equal(health.url(), undefined);
});
