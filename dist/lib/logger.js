"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
const config_js_1 = require("../config.js");
const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function shouldLog(level) {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[config_js_1.config.logLevel];
}
function format(level, scope, message, data) {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}`;
    if (data !== undefined) {
        return `${base} ${JSON.stringify(data)}`;
    }
    return base;
}
function createLogger(scope) {
    return {
        debug: (message, data) => {
            if (shouldLog("debug"))
                console.log(format("debug", scope, message, data));
        },
        info: (message, data) => {
            if (shouldLog("info"))
                console.log(format("info", scope, message, data));
        },
        warn: (message, data) => {
            if (shouldLog("warn"))
                console.warn(format("warn", scope, message, data));
        },
        error: (message, data) => {
            if (shouldLog("error"))
                console.error(format("error", scope, message, data));
        },
    };
}
