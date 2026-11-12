const http = require("node:http");
const { describeError } = require("../utils/helpers");

// Optional /healthz endpoint for uptime monitors. Off when the port is 0.
function createHealthServer({
  host = "127.0.0.1",
  port = 0,
  getState,
  logger,
}) {
  let server;
  let boundPort = port;

  const handler = (request, response) => {
    if (request.url !== "/healthz" && request.url !== "/") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    let state;
    try {
      state = getState();
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: describeError(error) }));
      return;
    }
    const ok = Boolean(state.connected);
    response.writeHead(ok ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ ok, ...state }));
  };

  return {
    start() {
      if (!port) return Promise.resolve(false);
      if (server) return Promise.resolve(true);
      server = http.createServer(handler);
      server.on("error", (error) =>
        logger?.warn(
          "HEALTH",
          `Health endpoint disabled: ${describeError(error)}`,
        ),
      );
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          boundPort = server.address()?.port ?? port;
          logger?.info(
            "HEALTH",
            `Health endpoint listening on http://${host}:${boundPort}/healthz`,
          );
          resolve(true);
        });
      });
    },
    stop() {
      if (!server) return Promise.resolve();
      const closing = server;
      server = undefined;
      return new Promise((resolve) => closing.close(() => resolve()));
    },
    port: () => boundPort,
    url: () => (boundPort ? `http://${host}:${boundPort}/healthz` : undefined),
  };
}

module.exports = { createHealthServer };
