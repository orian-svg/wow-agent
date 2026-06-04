"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slackEventsHandler = slackEventsHandler;
const logger_js_1 = require("../lib/logger.js");
const memory_js_1 = require("../lib/memory.js");
const redis_1 = require("@upstash/redis");
const crypto_1 = __importDefault(require("crypto"));
const log = (0, logger_js_1.createLogger)("slack-events");
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
function verifySlackSignature(req) {
    const timestamp = req.headers["x-slack-request-timestamp"];
    const signature = req.headers["x-slack-signature"];
    if (!timestamp || !signature)
        return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300)
        return false;
    const rawBody = JSON.stringify(req.body);
    const sigBase = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto_1.default.createHmac("sha256", SIGNING_SECRET);
    hmac.update(sigBase);
    const computed = `v0=${hmac.digest("hex")}`;
    return crypto_1.default.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}
async function slackEventsHandler(req, res) {
    const body = req.body;
    if (body.type === "url_verification") {
        res.json({ challenge: body.challenge });
        return;
    }
    if (SIGNING_SECRET && !verifySlackSignature(req)) {
        log.warn("Invalid Slack signature");
        res.sendStatus(401);
        return;
    }
    res.sendStatus(200);
    try {
        const event = body.event;
        if (!event)
            return;
        if (event.type !== "message" || event.subtype || !event.thread_ts)
            return;
        if (event.bot_id)
            return;
        const text = (event.text ?? "").trim().toLowerCase();
        if (text !== "!resolved")
            return;
        const threadTs = event.thread_ts;
        log.info(`!resolved command received for thread ${threadTs}`);
        const redis = new redis_1.Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        const keys = await redis.keys("res:*");
        for (const key of keys) {
            const data = await redis.get(key);
            if (data?.unhappySlackTs === threadTs) {
                const resId = key.replace("res:", "");
                await (0, memory_js_1.markManuallyResolved)(resId);
                log.info(`Reservation ${resId} manually resolved via !resolved command`);
                return;
            }
        }
        log.warn(`No reservation found for thread ${threadTs}`);
    }
    catch (err) {
        log.error("Slack events handler error", { error: String(err) });
    }
}
