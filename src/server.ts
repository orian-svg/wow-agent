import express from "express";
import { config } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { webhookHandler } from "./routes/webhook.js";
import { healthHandler } from "./routes/health.js";
import { sendDailyReport } from "./services/daily-report.js";

const log = createLogger("server");

function scheduleReports() {
  setInterval(() => {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    // ישראל UTC+3 — 21:00 = 18:00 UTC, 07:00 = 04:00 UTC
    if (hour === 18 && minute === 0) {
      log.info("Triggering evening report");
      sendDailyReport("evening").catch((err) => log.error("Evening report failed", { error: String(err) }));
    }

    if (hour === 4 && minute === 0) {
      log.info("Triggering morning report");
      sendDailyReport("morning").catch((err) => log.error("Morning report failed", { error: String(err) }));
    }
  }, 60 * 1000);

  log.info("Report scheduler started (evening 21:00 IL, morning 07:00 IL)");
}

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
    scheduleReports();
  });
}