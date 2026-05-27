"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookHandler = webhookHandler;
const logger_js_1 = require("../lib/logger.js");
const guesty_js_1 = require("../services/guesty.js");
const slack_js_1 = require("../services/slack.js");
const analyzer_js_1 = require("../services/analyzer.js");
const sentiment_js_1 = require("../services/sentiment.js");
const memory_js_1 = require("../lib/memory.js");
const log = (0, logger_js_1.createLogger)("webhook");
const INQUIRY_SOURCES = ["airbnb", "airbnb2", "vrbo"];
function formatStatus(status, isReturningGuest) {
    if (isReturningGuest)
        return "Returning Guest";
    const map = {
        inquiry: "Inquiry",
        reserved: "Inquiry",
        confirmed: "Confirmed",
        checked_in: "Checked In",
        checked_out: "Checked Out",
        cancelled: "Cancelled",
    };
    return map[status.toLowerCase()] ?? status;
}
function isInquiryStatus(status) {
    return ["inquiry", "reserved", "pending"].includes(status.toLowerCase());
}
function isInquirySource(source) {
    return INQUIRY_SOURCES.includes(source.toLowerCase());
}
function shouldRunWow(reservation) {
    if (reservation.isReturningGuest)
        return true;
    if (isInquiryStatus(reservation.status) && isInquirySource(reservation.source))
        return false;
    return true;
}
function extractMessagesFromThread(thread) {
    return thread
        .filter((m) => m.type === "fromGuest")
        .map((m) => m.body)
        .filter((b) => typeof b === "string" && b.trim().length > 0)
        .join("\n");
}
function countGuestMessages(thread) {
    return thread.filter((m) => m.type === "fromGuest").length;
}
function extractReservationId(event) {
    const conversation = event?.conversation ?? {};
    const meta = conversation.meta ?? {};
    const firstReservation = meta.reservations?.[0];
    return (event?.reservationId ??
        event?.reservation?._id ??
        firstReservation?._id ??
        conversation.reservationId ??
        null);
}
function extractConversationId(event) {
    const conversation = event?.conversation ?? {};
    return conversation._id ?? event?.conversationId ?? null;
}
function wasJustConfirmed(event) {
    const newStatus = event?.reservation?.status ?? event?.data?.reservation?.status ?? "";
    const oldStatus = event?.reservationBefore?.status ??
        event?.data?.reservationBefore?.status ??
        "";
    const wasInquiry = ["inquiry", "reserved", "pending"].includes(oldStatus.toLowerCase());
    const isNowConfirmed = newStatus.toLowerCase() === "confirmed";
    return wasInquiry && isNowConfirmed;
}
async function handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment, runWow, }) {
    // שמור שיחה ב-Redis
    if (guestMessages) {
        await (0, memory_js_1.saveConversation)(reservationId, guestMessages, {
            guestName: reservation.guestName,
            listingNickname: listing?.title ?? "Unknown",
            country: listing?.country ?? "",
            checkIn: reservation.checkIn,
            checkOut: reservation.checkOut,
            source: reservation.source,
        });
        log.info(`Conversation saved for ${reservation.guestName} (${reservationId})`);
    }
    const pastOpportunities = await (0, memory_js_1.getPastOpportunities)(reservationId);
    let guestHistory = "";
    if (reservation.guestId) {
        guestHistory = await (0, guesty_js_1.getGuestHistory)(reservation.guestId);
        if (guestHistory) {
            log.info(`Guest history loaded for ${reservation.guestName} (${guestHistory.length} chars)`);
        }
    }
    const promises = [];
    if (runWow) {
        promises.push((0, analyzer_js_1.analyze)(reservation.guestName, guestMessages, pastOpportunities, guestHistory).then(async (analysis) => {
            log.info("WOW analysis result", { isOpportunity: analysis.isOpportunity });
            if (!analysis.isOpportunity)
                return;
            const alertParams = (0, slack_js_1.buildAlertParams)({
                country: listing?.country ?? "",
                guestName: reservation.guestName,
                listingTitle: listing?.title ?? "Unknown",
                checkIn: reservation.checkIn,
                checkOut: reservation.checkOut,
                source: reservation.source,
                status,
                material: analysis.material,
                personal: analysis.personal,
                why: analysis.why,
            });
            await (0, slack_js_1.sendAlert)(alertParams);
            await (0, memory_js_1.recordOpportunity)(reservationId, analysis.why);
        }));
    }
    else {
        log.info(`WOW skipped — inquiry status from ${reservation.source}`);
    }
    if (runSentiment) {
        promises.push((0, sentiment_js_1.analyzeSentiment)(reservation.guestName, guestMessages, messageCount, reservation.checkIn, reservation.totalPrice).then(async (sentiment) => {
            log.info("Sentiment analysis result", { isUnhappy: sentiment.isUnhappy, urgency: sentiment.urgency });
            const lastUrgency = await (0, memory_js_1.getLastUnhappyUrgency)(reservationId);
            const threadTs = await (0, memory_js_1.getUnhappyThreadTs)(reservationId);
            const newUrgency = sentiment.isUnhappy ? sentiment.urgency : "resolved";
            const newRank = memory_js_1.URGENCY_RANK[newUrgency];
            const lastRank = lastUrgency !== undefined ? memory_js_1.URGENCY_RANK[lastUrgency] : undefined;
            if (!sentiment.isUnhappy && lastUrgency === undefined)
                return;
            if (sentiment.isUnhappy && (lastRank === undefined || newRank > lastRank)) {
                if (sentiment.urgency === "high") {
                    const ts = await (0, slack_js_1.sendUnhappyAlert)({
                        country: listing?.country ?? "",
                        guestName: reservation.guestName,
                        listingTitle: listing?.title ?? "Unknown",
                        checkIn: reservation.checkIn,
                        checkOut: reservation.checkOut,
                        source: reservation.source,
                        messageCount,
                        sentiment,
                        threadTs,
                    });
                    await (0, memory_js_1.recordUnhappyAlert)(reservationId, newUrgency, threadTs ? undefined : ts);
                }
                else {
                    await (0, memory_js_1.recordUnhappyAlert)(reservationId, newUrgency);
                    log.info(`Urgency ${sentiment.urgency} — saved for daily report, no real-time alert`);
                }
                return;
            }
            if (lastUrgency !== undefined && newRank < lastRank && threadTs) {
                await (0, slack_js_1.sendUnhappyResolved)({
                    country: listing?.country ?? "",
                    guestName: reservation.guestName,
                    isFullyResolved: !sentiment.isUnhappy,
                    newUrgency: sentiment.isUnhappy ? sentiment.urgency : undefined,
                    threadTs,
                });
                await (0, memory_js_1.recordUnhappyAlert)(reservationId, newUrgency);
            }
        }));
    }
    await Promise.all(promises);
}
async function webhookHandler(req, res) {
    res.sendStatus(200);
    try {
        const event = req.body;
        const eventType = event?.event ?? "";
        log.info("Webhook received", { eventType });
        log.debug("Full payload", JSON.stringify(event).substring(0, 500));
        const reservationId = extractReservationId(event);
        const conversationId = extractConversationId(event);
        if (!reservationId) {
            log.info("No reservationId found, skipping");
            return;
        }
        if (eventType === "reservation.updated") {
            if (!wasJustConfirmed(event)) {
                log.info("reservation.updated but not a confirmation transition, skipping");
                return;
            }
            log.info("Reservation just confirmed — analyzing full conversation");
            const reservation = await (0, guesty_js_1.getReservation)(reservationId);
            if (!reservation)
                return;
            const thread = event?.conversation?.thread ?? [];
            let guestMessages = extractMessagesFromThread(thread);
            if (!guestMessages && conversationId) {
                guestMessages = await (0, guesty_js_1.getConversation)(conversationId);
            }
            if (!guestMessages) {
                log.info("No guest messages found in confirmed reservation, skipping");
                return;
            }
            const messageCount = countGuestMessages(thread);
            const listing = reservation.listingId ? await (0, guesty_js_1.getListing)(reservation.listingId) : null;
            const status = formatStatus(reservation.status, reservation.isReturningGuest);
            log.info("Context resolved", {
                guestName: reservation.guestName,
                listingTitle: listing?.title ?? "Unknown",
                country: listing?.country ?? "",
                status,
            });
            await handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment: false, runWow: true });
            return;
        }
        if (eventType === "reservation.messageReceived") {
            const conversation = event?.conversation ?? {};
            const thread = conversation.thread ?? [];
            const guestMessages = extractMessagesFromThread(thread);
            if (!guestMessages) {
                log.info("No guest messages found, skipping");
                return;
            }
            const messageCount = countGuestMessages(thread);
            const reservation = await (0, guesty_js_1.getReservation)(reservationId);
            if (!reservation)
                return;
            const listing = reservation.listingId ? await (0, guesty_js_1.getListing)(reservation.listingId) : null;
            const status = formatStatus(reservation.status, reservation.isReturningGuest);
            log.info("Context resolved", {
                guestName: reservation.guestName,
                listingTitle: listing?.title ?? "Unknown",
                country: listing?.country ?? "",
                status,
                isReturningGuest: reservation.isReturningGuest,
            });
            const runWow = shouldRunWow(reservation);
            await handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment: true, runWow });
            return;
        }
        log.info("Unknown event type, skipping", { eventType });
    }
    catch (err) {
        log.error("Webhook handler error", { error: String(err) });
    }
}
