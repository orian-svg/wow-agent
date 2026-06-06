"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUnhappy = handleUnhappy;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const logger_js_1 = require("../lib/logger.js");
const slack_js_1 = require("./slack.js");
const sentiment_js_1 = require("./sentiment.js");
const memory_js_1 = require("../lib/memory.js");
const config_js_1 = require("../config.js");
const log = (0, logger_js_1.createLogger)("unhappy-agent");
const client = new sdk_1.default({ apiKey: config_js_1.config.anthropicApiKey });
async function isSameIssue(previousIssue, newIssue) {
    if (!previousIssue || !newIssue)
        return false;
    const response = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 50,
        system: `You are comparing two guest complaint descriptions to determine if they are about the same underlying problem.
Answer only YES or NO.
YES = same root problem, even if described differently or with new details.
NO = clearly different problem.`,
        messages: [{
                role: "user",
                content: `Previous issue: ${previousIssue}\nNew issue: ${newIssue}\nSame problem?`
            }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return /^\s*yes/i.test(text);
}
async function handleUnhappy({ reservationId, guestMessages, messageCount, reservation, listing, }) {
    const sentiment = await (0, sentiment_js_1.analyzeSentiment)(reservation.guestName, guestMessages, messageCount, reservation.checkIn, reservation.checkOut, reservation.totalPrice);
    log.info("Sentiment analysis result", { isUnhappy: sentiment.isUnhappy, urgency: sentiment.urgency });
    const lastUrgency = await (0, memory_js_1.getLastUnhappyUrgency)(reservationId);
    const threadTs = await (0, memory_js_1.getUnhappyThreadTs)(reservationId);
    const newUrgency = sentiment.isUnhappy ? sentiment.urgency : "resolved";
    const newRank = memory_js_1.URGENCY_RANK[newUrgency];
    const lastRank = lastUrgency !== undefined ? memory_js_1.URGENCY_RANK[lastUrgency] : undefined;
    if (!sentiment.isUnhappy && lastUrgency === undefined)
        return;
    if (sentiment.isUnhappy && sentiment.urgency === "high") {
        const lastIssue = await (0, memory_js_1.getLastUnhappyIssue)(reservationId);
        if (lastIssue && lastUrgency === "high") {
            const same = await isSameIssue(lastIssue, sentiment.issue);
            if (same) {
                log.info(`Same High issue already reported — skipping duplicate alert`);
                return;
            }
        }
        const isAdditionalIssue = lastUrgency === "high";
        const ts = await (0, slack_js_1.sendUnhappyAlert)({
            country: listing?.country ?? "",
            guestName: reservation.guestName,
            listingTitle: listing?.title ?? "Unknown",
            checkIn: reservation.checkIn,
            checkOut: reservation.checkOut,
            source: reservation.source,
            messageCount,
            sentiment,
            threadTs: undefined,
            isAdditionalIssue,
        });
        await (0, memory_js_1.recordUnhappyAlert)(reservationId, newUrgency, ts, sentiment.issue);
        return;
    }
    if (sentiment.isUnhappy && (lastRank === undefined || newRank > lastRank)) {
        await (0, memory_js_1.recordUnhappyAlert)(reservationId, newUrgency, undefined, sentiment.issue);
        log.info(`Urgency ${sentiment.urgency} — saved for daily report, no real-time alert`);
        return;
    }
    if (lastUrgency !== undefined && newRank < lastRank && threadTs) {
        const alreadySent = await (0, memory_js_1.isResolvedSlackSent)(reservationId);
        if (!alreadySent) {
            await (0, slack_js_1.sendUnhappyResolved)({
                country: listing?.country ?? "",
                guestName: reservation.guestName,
                isFullyResolved: !sentiment.isUnhappy,
                newUrgency: sentiment.isUnhappy ? sentiment.urgency : undefined,
                threadTs,
            });
            await (0, memory_js_1.markResolvedSlackSent)(reservationId);
        }
        else {
            log.info(`Resolved message already sent for ${reservation.guestName} — skipping`);
        }
        await (0, memory_js_1.recordUnhappyAlert)(reservationId, newUrgency);
    }
}
