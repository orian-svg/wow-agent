"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
function requireEnv(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function optionalEnv(key, fallback) {
    return process.env[key] ?? fallback;
}
exports.config = {
    port: parseInt(optionalEnv("PORT", "3000"), 10),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    guestyClientId: requireEnv("GUESTY_CLIENT_ID"),
    guestyClientSecret: requireEnv("GUESTY_CLIENT_SECRET"),
    slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
    slackChannelIsrael: optionalEnv("SLACK_CHANNEL_ISRAEL", "#wow-israel"),
    slackChannelAthens: optionalEnv("SLACK_CHANNEL_ATHENS", "#wow-athens"),
    logLevel: optionalEnv("LOG_LEVEL", "info"),
};
