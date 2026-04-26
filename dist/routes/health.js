"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthHandler = healthHandler;
function healthHandler(_req, res) {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
}
