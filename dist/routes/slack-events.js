"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slackEventsHandler = slackEventsHandler;
const logger_js_1 = require("../lib/logger.js");
const memory_js_1 = require("../lib/memory.js");
const redis_1 = require("@upstash/redis");
const log = (0, logger_js_1.createLogger)("slack-events");
async function slackEventsHandler(req, res) {
    const body = req.body;
    // אימות URL מסלאק — חייב להגיב מיד ללא אימות חתימה
    if (body.type === "url_verification") {
        log.info("Slack URL verification challenge received");
        res.json({ challenge: body.challenge });
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
