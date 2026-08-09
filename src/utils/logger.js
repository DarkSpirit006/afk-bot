const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger(level = "info") {
  const configured = String(level).toLowerCase();
  const threshold = LEVELS[configured] || LEVELS.info;
  const write = (severity, category, message) => {
    if (LEVELS[severity] < threshold) return;
    const line = `[${new Date().toLocaleTimeString()}] [${category}] ${message}`;
    (severity === "error" ? console.error : severity === "warn" ? console.warn : console.log)(line);
  };
  return {
    debug: (category, message) => write("debug", category, message),
    info: (category, message) => write("info", category, message),
    warn: (category, message) => write("warn", category, message),
    error: (category, message) => write("error", category, message),
  };
}

module.exports = { createLogger, LEVELS };
