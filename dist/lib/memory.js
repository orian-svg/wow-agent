"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.URGENCY_RANK = void 0;
exports.getPastOpportunities = getPastOpportunities;
exports.recordOpportunity = recordOpportunity;
exports.getLastUnhappyUrgency = getLastUnhappyUrgency;
exports.getUnhappyThreadTs = getUnhappyThreadTs;
exports.getLastUnhappyIssue = getLastUnhappyIssue;
exports.recordUnhappyAlert = recordUnhappyAlert;
exports.getWowThreadTs = getWowThreadTs;
exports.recordWowAlert = recordWowAlert;
exports.saveConversation = saveConversation;
exports.getAllActiveConversations = getAllActiveConversations;
const logger_js_1 = require("./logger.js");
const redis_1 = require("@upstash/redis");
const log = (0, logger_js_1.createLogger)("memory");
const redis = new redis_1.Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
async function getRecord(reservationId) {
    try {
        const data = await redis.get(`res:${reservationId}`);
        return data ?? { sentOpportunities: [] };
    }
    catch {
        log.warn(`Could not read from Redis for ${reservationId}`);
        return { sentOpportunities: [] };
    }
}
async function setRecord(reservationId, data) {
    try {
        // שמירה ל-30 יום
        await redis.set(`res:${reservationId}`, data, { ex: 60 * 60 * 24 * 30 });
    }
    catch (err) {
        log.error(`Could not write to Redis for ${reservationId}`, { error: String(err) });
    }
}
async function getPastOpportunities(reservationId) {
    const data = await getRecord(reservationId);
    return data.sentOpportunities ?? [];
}
async function recordOpportunity(reservationId, why) {
    const data = await getRecord(reservationId);
    data.sentOpportunities = [...(data.sentOpportunities ?? []), why];
    await setRecord(reservationId, data);
    log.info(`Recorded opportunity for reservation ${reservationId}`);
}
exports.URGENCY_RANK = {
    resolved: -1,
    low: 0,
    medium: 1,
    high: 2,
};
async function getLastUnhappyUrgency(reservationId) {
    const data = await getRecord(reservationId);
    return data.lastUnhappyUrgency;
}
async function getUnhappyThreadTs(reservationId) {
    const data = await getRecord(reservationId);
    return data.unhappySlackTs;
}
async function getLastUnhappyIssue(reservationId) {
    const data = await getRecord(reservationId);
    return data.lastUnhappyIssue;
}
async function recordUnhappyAlert(reservationId, urgency, slackTs, issue) {
    const data = await getRecord(reservationId);
    data.lastUnhappyUrgency = urgency;
    if (slackTs)
        data.unhappySlackTs = slackTs;
    if (issue)
        data.lastUnhappyIssue = issue;
    await setRecord(reservationId, data);
    log.info(`Recorded unhappy alert for reservation ${reservationId} (urgency: ${urgency})`);
}
async function getWowThreadTs(reservationId) {
    const data = await getRecord(reservationId);
    return data.wowSlackTs;
}
async function recordWowAlert(reservationId, slackTs) {
    const data = await getRecord(reservationId);
    if (slackTs)
        data.wowSlackTs = slackTs;
    await setRecord(reservationId, data);
}
async function saveConversation(reservationId, messages, meta) {
    const data = await getRecord(reservationId);
    data.conversationMessages = messages;
    data.guestName = meta.guestName;
    data.listingNickname = meta.listingNickname;
    data.country = meta.country;
    data.checkIn = meta.checkIn;
    data.checkOut = meta.checkOut;
    data.source = meta.source;
    data.lastUpdated = new Date().toISOString();
    await setRecord(reservationId, data);
}
async function getAllActiveConversations() {
    try {
        const keys = await redis.keys("res:*");
        const results = [];
        for (const key of keys) {
            const data = await redis.get(key);
            if (!data?.conversationMessages || !data?.guestName)
                continue;
            // מסנן הזמנות שהצ'ק-אאוט עבר יותר מ-2 ימים
            if (data.checkOut) {
                const checkOut = new Date(data.checkOut);
                const twoDaysAgo = new Date();
                twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                if (checkOut < twoDaysAgo)
                    continue;
            }
            const reservationId = key.replace("res:", "");
            results.push({
                reservationId,
                messages: data.conversationMessages,
                guestName: data.guestName,
                listingNickname: data.listingNickname ?? "Unknown",
                country: data.country ?? "",
                checkIn: data.checkIn ?? "",
                checkOut: data.checkOut ?? "",
                source: data.source ?? "",
                lastUpdated: data.lastUpdated ?? "",
            });
        }
        return results;
    }
    catch (err) {
        log.error("Failed to get active conversations from Redis", { error: String(err) });
        return [];
    }
}
