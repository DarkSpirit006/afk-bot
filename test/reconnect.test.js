const test = require("node:test");
const assert = require("node:assert/strict");
const { createReconnect } = require("../src/services/reconnect");
test("reconnect coalesces duplicate schedules and can be cancelled", async () => {
  let calls = 0; const service = createReconnect({ delayMs: 5, connect: () => calls++, logger: { info() {} } });
  service.schedule(); service.schedule(); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, 1);
  service.schedule(); service.cancel(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(calls, 1);
});
