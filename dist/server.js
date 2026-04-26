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
const log = (0, logger_js_1.createLogger)("server");
function createServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: "2mb" }));
    app.post("/webhook", webhook_js_1.webhookHandler);
    app.get("/health", health_js_1.healthHandler);
    return app;
}
function startServer() {
    const app = createServer();
    app.listen(config_js_1.config.port, () => {
        log.info(`WOW Agent listening on port ${config_js_1.config.port}`);
    });
}
