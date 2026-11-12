const fs = require("node:fs");
const { describeError, redact } = require("./helpers");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LABELS = { debug: "DEBUG", info: "INFO ", warn: "WARN ", error: "ERROR" };

function consoleWriter(line, severity) {
  const write =
    severity === "error"
      ? console.error
      : severity === "warn"
        ? console.warn
        : console.log;
  write(line);
}

function createFileWriter(filePath) {
  let warned = false;
  return (line) => {
    try {
      fs.appendFileSync(filePath, `${line}\n`, "utf8");
    } catch (error) {
      if (warned) return;
      warned = true;
      console.warn(
        `Cannot write logs to ${filePath}: ${describeError(error)}. Continuing without a log file.`,
      );
    }
  };
}

/**
 * Creates a logger. Accepts a bare level string (backwards compatible) or an
 * options object: { level, filePath, secrets, write, clock }.
 */
function createLogger(levelOrOptions = "info") {
  const options =
    typeof levelOrOptions === "string"
      ? { level: levelOrOptions }
      : levelOrOptions || {};
  const configured = String(options.level || "info").toLowerCase();
  const threshold = LEVELS[configured] ?? LEVELS.info;
  const secrets = options.secrets || [];
  const clock = options.clock || (() => new Date());
  const write = options.write || consoleWriter;
  const writeFile = options.filePath
    ? createFileWriter(options.filePath)
    : undefined;

  const log = (severity, category, message) => {
    if ((LEVELS[severity] ?? LEVELS.info) < threshold) return;
    const timestamp = clock().toISOString();
    const line = redact(
      `${timestamp} [${LABELS[severity]}] [${category}] ${message}`,
      secrets,
    );
    write(line, severity);
    if (writeFile) writeFile(line);
  };

  return {
    level: configured,
    debug: (category, message) => log("debug", category, message),
    info: (category, message) => log("info", category, message),
    warn: (category, message) => log("warn", category, message),
    error: (category, message) => log("error", category, message),
    child: (category) => ({
      debug: (message) => log("debug", category, message),
      info: (message) => log("info", category, message),
      warn: (message) => log("warn", category, message),
      error: (message) => log("error", category, message),
    }),
  };
}

/** A logger that records everything in memory; used by tests. */
function createMemoryLogger() {
  const lines = [];
  return {
    lines,
    debug: (category, message) =>
      lines.push({ level: "debug", category, message }),
    info: (category, message) =>
      lines.push({ level: "info", category, message }),
    warn: (category, message) =>
      lines.push({ level: "warn", category, message }),
    error: (category, message) =>
      lines.push({ level: "error", category, message }),
    text: () => lines.map((line) => line.message).join("\n"),
  };
}

module.exports = { createLogger, createMemoryLogger, LEVELS };
