// Pending /tpa and /tpahere requests. Small queue with ids so a master can answer
// !y, !y 2 or just let one expire; everyone in the queue gets told what happened.
function createTeleport({
  getBot,
  logger,
  approvalMs = 30000,
  cooldownMs = 5000,
  maxPending = 5,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  onEvent,
}) {
  const pending = [];
  const timers = new Map();
  let lastAcceptedAt = null;
  let nextId = 1;

  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch (error) {
      logger?.error("TPA", `Teleport event handler failed: ${error.message}`);
    }
  };

  const drop = (request, reason) => {
    const index = pending.indexOf(request);
    if (index >= 0) pending.splice(index, 1);
    const timer = timers.get(request.id);
    if (timer !== undefined) cancel(timer);
    timers.delete(request.id);
    emit({ type: reason, request });
  };

  const accept = (request) => {
    try {
      getBot()?.chat("/tpaccept");
    } catch (error) {
      logger?.warn("TPA", `Could not accept the teleport: ${error.message}`);
    }
    lastAcceptedAt = now();
    logger?.info("TPA", `Accepted ${request.type} from ${request.sender}.`);
    drop(request, "accepted");
  };

  const isCoolingDown = () =>
    cooldownMs > 0 &&
    lastAcceptedAt !== null &&
    now() - lastAcceptedAt < cooldownMs;

  const find = (id) => {
    if (id === undefined || id === null || String(id).trim() === "")
      return pending[0];
    const parsed = Number(id);
    if (!Number.isInteger(parsed)) return undefined;
    return pending.find((request) => request.id === parsed);
  };

  return {
    /** Queues a request. Returns { status, request }. */
    request(sender, type) {
      if (isCoolingDown()) return { status: "cooldown" };
      if (pending.some((request) => request.sender === sender))
        return {
          status: "duplicate",
          request: pending.find((r) => r.sender === sender),
        };
      if (pending.length >= maxPending) return { status: "full" };

      const request = {
        id: nextId++,
        sender,
        type,
        createdAt: now(),
        expiresAt: now() + approvalMs,
      };
      pending.push(request);
      timers.set(
        request.id,
        schedule(() => {
          timers.delete(request.id);
          if (pending.includes(request)) drop(request, "expired");
        }, approvalMs),
      );
      logger?.info(
        "TPA",
        `Awaiting master approval for ${type} from ${sender} (request ${request.id}).`,
      );
      return { status: "pending", request };
    },
    /** Accepts or rejects a pending request (oldest by default). */
    reply(acceptRequest, id) {
      const request = find(id);
      if (!request) {
        emit({ type: "missing", request: undefined });
        return { status: "none" };
      }
      if (acceptRequest) {
        accept(request);
        return { status: "accepted", request };
      }
      drop(request, "rejected");
      return { status: "rejected", request };
    },
    /** Accepts immediately without approval (master or public access). */
    acceptNow(sender, type) {
      if (isCoolingDown()) return { status: "cooldown" };
      try {
        getBot()?.chat("/tpaccept");
      } catch (error) {
        logger?.warn("TPA", `Could not accept the teleport: ${error.message}`);
      }
      lastAcceptedAt = now();
      logger?.info("TPA", `Accepted ${type} from ${sender}.`);
      return { status: "accepted", request: { sender, type } };
    },
    pending: () => [...pending],
    size: () => pending.length,
    stop() {
      for (const request of [...pending]) drop(request, "cancelled");
      for (const timer of timers.values()) cancel(timer);
      timers.clear();
    },
  };
}

module.exports = { createTeleport };
