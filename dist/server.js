"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const config_js_1 = require("./config.js");
const logger_js_1 = require("./lib/logger.js");
const webhook_js_1 = require("./routes/webhook.js");
const health_js_1 = require("./routes/health.js");
const slack_events_js_1 = require("./routes/slack-events.js");
const daily_report_js_1 = require("./services/daily-report.js");
const log = (0, logger_js_1.createLogger)("server");
function scheduleReports() {
    setInterval(() => {
        const now = new Date();
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();
        // ישראל UTC+3 — 21:00 = 18:00 UTC, 07:00 = 04:00 UTC
        if (hour === 18 && minute === 0) {
            log.info("Triggering evening report");
            (0, daily_report_js_1.sendDailyReport)("evening").catch((err) => log.error("Evening report failed", { error: String(err) }));
        }
        if (hour === 4 && minute === 0) {
            log.info("Triggering morning report");
            (0, daily_report_js_1.sendDailyReport)("morning").catch((err) => log.error("Morning report failed", { error: String(err) }));
        }
    }, 60 * 1000);
    log.info("Report scheduler started (evening 21:00 IL, morning 07:00 IL)");
}
function createServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: "2mb" }));
    app.post("/webhook", webhook_js_1.webhookHandler);
    app.post("/slack/events", slack_events_js_1.slackEventsHandler);
    app.get("/health", health_js_1.healthHandler);
    return app;
}
function startServer() {
    const app = createServer();
    app.listen(config_js_1.config.port, () => {
        log.info(`WOW Agent listening on port ${config_js_1.config.port}`);
        scheduleReports();
    });
}
