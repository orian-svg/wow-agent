import express from "express";
import { config } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { webhookHandler } from "./routes/webhook.js";
import { healthHandler } from "./routes/health.js";

const log = createLogger("server");

export function createServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.post("/webhook", webhookHandler);
  app.get("/health", healthHandler);

  return app;
}

export function startServer() {
  const app = createServer();
  app.listen(config.port, () => {
    log.info(`WOW Agent listening on port ${config.port}`);
  });
}