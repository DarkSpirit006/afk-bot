const { describeError } = require("../utils/helpers");
const { encodeClickAction } = require("./click-action");
const { generateTotp } = require("../utils/totp");

// AuthMe 6 login dialogs (MC 1.21.6+). Two flavours, both handled here:
//
//   pre-join   shown during configuration, before the bot is in the world.
//              Buttons are dynamic/custom, so the answer is a
//              custom_click_action packet with the field values, e.g.
//              { password } for authme:prejoin-login/submit.
//   post-join  buttons are dynamic/run_command templates like
//              "login $(password)", so the answer is a plain chat command.
//
// Inputs and the submit action come from the packet, so a translated or
// rearranged dialog still works.

const SUBMIT_RE = /\/(submit)$/i;
const CANCEL_RE = /\/(cancel)$/i;
const RECOVERY_RE = /recovery/i;
const REGISTER_RE = /register/i;
const LOGIN_RE = /login|log-in/i;
const TOTP_RE = /2fa|two[-_ ]?factor|totp|\bcode\b/i;

const NBT_TAGS = new Set([
  "compound",
  "list",
  "string",
  "int",
  "byte",
  "short",
  "long",
  "float",
  "double",
  "byteArray",
  "intArray",
  "longArray",
  "end",
]);

// Digs the dialog out of whatever we were handed: the config-state packet has
// the NBT directly, the play-state one wraps it in a Holder ({ data }), and the
// tests pass plain objects.
function simplifyDialog(value, nbt) {
  if (!value || typeof value !== "object") return undefined;
  if (value.data) return simplifyDialog(value.data, nbt);
  if (value.dialog) return simplifyDialog(value.dialog, nbt);
  if (
    typeof value.type === "string" &&
    NBT_TAGS.has(value.type) &&
    "value" in value
  )
    return nbt.simplify(value);
  return value;
}

function textOf(component) {
  if (component === undefined || component === null) return "";
  if (typeof component === "string") return component;
  if (Array.isArray(component)) return component.map(textOf).join("");
  if (typeof component === "object") {
    if (typeof component.text === "string" && component.text)
      return component.text;
    if (typeof component.translate === "string") return component.translate;
    if (Array.isArray(component.extra))
      return `${textOf(component.text || "")}${component.extra.map(textOf).join("")}`;
  }
  return "";
}

// Collects inputs, actions and templates from anywhere in the dialog. Loose on
// purpose: fields were added and removed between 1.21.6 and 1.21.9.
function collect(
  node,
  found = { inputs: [], actions: [], templates: [], texts: [] },
) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, found);
    return found;
  }

  if (typeof node.key === "string" && node.key && found.inputs.length < 20)
    found.inputs.push({
      key: node.key,
      type: typeof node.type === "string" ? node.type : "minecraft:text",
      maxLength: Number(node.max_length) || undefined,
      label: textOf(node.label),
    });

  if (typeof node.id === "string" && typeof node.type === "string")
    found.actions.push({ id: node.id, type: node.type });

  if (typeof node.template === "string" && node.template)
    found.templates.push(node.template);

  if (typeof node.text === "string" && node.text) found.texts.push(node.text);

  for (const value of Object.values(node)) collect(value, found);
  return found;
}

/** Turns a `show_dialog` payload into a description of what it asks for. */
function describeDialog(rawDialog, nbt) {
  const dialog = simplifyDialog(rawDialog, nbt);
  const found = collect(dialog);
  const submit = found.actions.find(
    (action) => SUBMIT_RE.test(action.id) && !CANCEL_RE.test(action.id),
  );
  const cancel = found.actions.find((action) => CANCEL_RE.test(action.id));
  const usableTemplate = found.templates.find(
    (template) => !/recover|forgot/i.test(template),
  );

  const haystack = [submit?.id, usableTemplate, ...found.texts]
    .filter(Boolean)
    .join(" ");

  let kind = "unknown";
  if (TOTP_RE.test(haystack) && !REGISTER_RE.test(haystack)) kind = "totp";
  if (REGISTER_RE.test(haystack)) kind = "register";
  else if (LOGIN_RE.test(haystack) && kind !== "totp") kind = "login";
  if (RECOVERY_RE.test(submit?.id || "")) kind = "recovery";

  return {
    kind,
    inputs: found.inputs,
    inputKeys: found.inputs.map((input) => input.key),
    submitId: submit?.id,
    cancelId: cancel?.id,
    commandTemplate: usableTemplate,
    titles: found.texts.slice(0, 3),
    hasTotpSecretInput: found.inputs.some((input) => /code/i.test(input.key)),
  };
}

/** Replaces `$(key)` placeholders in a command template. */
function expandTemplate(template, values) {
  if (!template) return "";
  return template.replace(/\$\(([A-Za-z0-9_]+)\)/g, (_match, key) =>
    values[key] === undefined ? "" : String(values[key]),
  );
}

/**
 * Chooses the values to submit for a dialog.
 * Returns { status: "ready" | "skip" | "missing", values, reason }.
 */
function buildValues(description, credentials) {
  const { password, email, totpCode } = credentials;
  const keys = description.inputKeys;
  const values = {};
  const isEmailRegistration =
    keys.includes("email") && !keys.includes("password");

  for (const key of keys) {
    const lower = key.toLowerCase();
    if (/password|passwort|mot_de_passe/.test(lower)) values[key] = password;
    else if (/confirm|again|repeat|verify/.test(lower))
      values[key] = isEmailRegistration ? email : password;
    else if (/email|mail/.test(lower)) values[key] = email;
    else if (/code|totp|token/.test(lower)) values[key] = totpCode;
  }

  if (description.kind === "login" && !password)
    return { status: "skip", reason: "no AUTH_PASSWORD configured" };
  if (description.kind === "register" && !password && !email)
    return {
      status: "skip",
      reason: "no AUTH_PASSWORD or AUTH_EMAIL configured",
    };
  if (description.kind === "register" && keys.includes("email") && !email)
    return {
      status: "skip",
      reason: "the registration dialog requires AUTH_EMAIL",
    };
  if (description.kind === "recovery" && !email)
    return {
      status: "skip",
      reason: "the recovery dialog requires AUTH_EMAIL",
    };
  if (description.kind === "totp" && !totpCode)
    return { status: "skip", reason: "no AUTH_TOTP_SECRET configured" };

  const filled = Object.entries(values).filter(([, value]) => value);
  if (!filled.length) return { status: "skip", reason: "no matching input" };

  return { status: "ready", values };
}

function createDialogAuth({
  getClient,
  getBot,
  password = "",
  email = "",
  totpSecret = "",
  maxAttempts = 3,
  retryMs = 5000,
  enabled = true,
  logger,
  nbt,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  onSubmitted,
  onSkipped,
}) {
  let attempts = 0;
  let lastAttemptAt = 0;
  let gaveUp = false;
  let lastDialogAt = 0;
  let attachedTo;
  let pendingKind;
  let retryTimer;
  let flushTimer;
  let flushAttempts = 0;
  const queued = [];
  const history = [];

  const reset = () => {
    if (retryTimer !== undefined) cancel(retryTimer);
    if (flushTimer !== undefined) cancel(flushTimer);
    retryTimer = undefined;
    flushTimer = undefined;
    flushAttempts = 0;
    queued.length = 0;
    attempts = 0;
    lastAttemptAt = 0;
    gaveUp = false;
    pendingKind = undefined;
    history.length = 0;
  };

  const credentials = () => {
    let totpCode = "";
    if (totpSecret) {
      try {
        totpCode = generateTotp({ secret: totpSecret, timestamp: now() });
      } catch (error) {
        logger?.warn(
          "AUTH",
          `Cannot generate a one-time code: ${describeError(error)}`,
        );
      }
    }
    return { password, email, totpCode };
  };

  const describe = (packet) => describeDialog(packet?.dialog, nbt);

  const send = (description, values) => {
    const client = getClient();
    if (!client) return false;
    try {
      client.writeRaw(
        encodeClickAction({
          state: client.state,
          // The packet id moves between versions, so use the one the client
          // negotiated.
          version: client.version ?? getBot()?.version,
          id: description.submitId,
          values,
        }),
      );
      return true;
    } catch (error) {
      logger?.error(
        "AUTH",
        `Could not answer the login dialog: ${describeError(error)}`,
      );
      return false;
    }
  };

  /** Retries a send that failed because the client was not ready yet. */
  const retry = (description, values, attempt) => {
    if (attempt > 3 || gaveUp) return;
    if (retryTimer !== undefined) cancel(retryTimer);
    retryTimer = schedule(() => {
      retryTimer = undefined;
      logger?.warn(
        "AUTH",
        `Retrying the ${description.kind} dialog answer (${attempt}/3).`,
      );
      if (
        !(description.submitId
          ? send(description, values)
          : runCommand(description, values))
      )
        retry(description, values, attempt + 1);
    }, 1000);
  };

  // Chat only goes out once the client is in the play state; before that
  // mineflayer drops it silently.
  const chatReady = () => {
    const client = getClient();
    return !client || !client.state || client.state === "play";
  };

  /** Sends queued commands once the client is in the play state. */
  const flush = () => {
    if (flushTimer !== undefined) cancel(flushTimer);
    flushTimer = undefined;
    if (!queued.length) return;
    if (!chatReady()) {
      if (flushAttempts >= 20) {
        logger?.warn(
          "AUTH",
          "Gave up waiting for the client to join; dropping the queued login command.",
        );
        queued.length = 0;
        flushAttempts = 0;
        return;
      }
      flushAttempts += 1;
      flushTimer = schedule(flush, 250);
      return;
    }
    flushAttempts = 0;
    while (queued.length) {
      const command = queued.shift();
      try {
        getBot()?.chat(command);
        logger?.info("AUTH", "Sent the queued login command.");
      } catch (error) {
        logger?.warn("AUTH", `Queued login command failed: ${describeError(error)}`);
      }
    }
  };

  const runCommand = (description, values) => {
    const command = expandTemplate(description.commandTemplate, values).trim();
    if (!command) return false;
    const bot = getBot();
    // A post-join dialog can arrive while the client is still joining, so the
    // command waits for the play state.
    if (!chatReady()) {
      queued.push(`/${command.replace(/^\//, "")}`);
      logger?.info(
        "AUTH",
        "Queued the login command until the bot finishes joining.",
      );
      flush();
      return true;
    }
    try {
      bot?.chat(`/${command.replace(/^\//, "")}`);
      return true;
    } catch (error) {
      logger?.error(
        "AUTH",
        `Could not answer the login dialog: ${describeError(error)}`,
      );
      return false;
    }
  };

  /** Handles one `show_dialog` packet. Exported so it can be tested directly. */
  function handle(packet) {
    if (!enabled) return { status: "disabled" };
    lastDialogAt = now();
    const description = describe(packet);

    if (!description.submitId && !description.commandTemplate) {
      logger?.info(
        "AUTH",
        "A dialog was shown without a submit action (probably a notice); ignoring it.",
      );
      return { status: "ignored", description };
    }
    if (description.kind === "unknown") {
      logger?.info(
        "AUTH",
        `Ignoring an unrecognised dialog${description.titles.length ? `: ${description.titles[0]}` : ""}.`,
      );
      return { status: "ignored", description };
    }

    if (gaveUp) {
      logger?.warn(
        "AUTH",
        "Ignoring a login dialog because the attempt limit was already reached.",
      );
      return { status: "gave-up", description };
    }
    if (attempts >= maxAttempts) {
      gaveUp = true;
      logger?.error(
        "AUTH",
        `Gave up after ${attempts} dialog attempts; check AUTH_PASSWORD for this account.`,
      );
      return { status: "gave-up", description };
    }
    // Only the same dialog coming back means the attempt failed. A different
    // one (the 2FA step after a good password) is answered right away.
    if (
      attempts > 0 &&
      pendingKind === description.kind &&
      now() - lastAttemptAt < retryMs
    ) {
      logger?.warn(
        "AUTH",
        `The server re-sent the ${description.kind} dialog; waiting before retrying.`,
      );
      return { status: "throttled", description };
    }

    const { status, values, reason } = buildValues(description, credentials());
    if (status !== "ready") {
      logger?.warn(
        "AUTH",
        `Cannot answer the ${description.kind} dialog: ${reason}.`,
      );
      onSkipped?.({ description, reason });
      return { status: "skipped", description, reason };
    }

    attempts += 1;
    lastAttemptAt = now();
    pendingKind = description.kind;
    history.push({ kind: description.kind, at: lastAttemptAt });

    const sent = description.submitId
      ? send(description, values)
      : runCommand(description, values);
    if (!sent) {
      // A post-join dialog can land before the client is ready to send.
      retry(description, values, 1);
    }
    logger?.info(
      "AUTH",
      `${
        description.submitId ? "Answered" : "Completed"
      } the ${description.kind} dialog (attempt ${attempts}/${maxAttempts})${
        description.inputKeys.length
          ? ` with fields ${description.inputKeys.join(", ")}`
          : ""
      }.`,
    );
    onSubmitted?.({ description, attempts, sent });
    return { status: sent ? "submitted" : "failed", description, values };
  }

  return {
    /** Registers packet listeners on the current mineflayer client. */
    attach(client = getClient()) {
      if (!client || attachedTo === client) return false;
      attachedTo = client;
      reset();
      client.on("show_dialog", (packet) => {
        try {
          handle(packet);
        } catch (error) {
          logger?.error(
            "AUTH",
            `Dialog handling failed: ${describeError(error)}`,
          );
        }
      });
      client.on("clear_dialog", () => {
        pendingKind = undefined;
        lastDialogAt = now();
      });
      client.on("state", (state) => {
        // A new connection starts a new authentication round.
        if (state === "configuration" || state === "login") reset();
        if (state === "play") flush();
      });
      return true;
    },
    handle,
    describe: (packet) => describe(packet),
    reset,
    queued: () => [...queued],
    flush,
    /** True while a dialog flow is in progress; suppresses chat-based auth. */
    isBusy: () => Boolean(pendingKind) && now() - lastDialogAt < 60000,
    attempts: () => attempts,
    gaveUp: () => gaveUp,
    history: () => [...history],
  };
}

module.exports = {
  buildValues,
  createDialogAuth,
  describeDialog,
  expandTemplate,
  textOf,
};
