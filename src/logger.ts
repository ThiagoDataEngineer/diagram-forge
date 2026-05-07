import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "*.preimage",
      "*.macaroon",
      "*.api_key",
      "*.secret",
      "*.MACAROON_SECRET",
    ],
    censor: "[REDACTED]",
  },
});
