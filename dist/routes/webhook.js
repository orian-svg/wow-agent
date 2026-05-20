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
async function handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment, }) {
    const pastOpportunities = (0, memory_js_1.getPastOpportunities)(reservationId);
    const promises = [];
    promises.push((0, analyzer_js_1.analyze)(reservation.guestName, guestMessages, pastOpportunities).then(async (analysis) => {
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
        (0, memory_js_1.recordOpportunity)(reservationId, analysis.why);
    }));
    if (runSentiment) {
        promises.push((0, sentiment_js_1.analyzeSentiment)(reservation.guestName, guestMessages, messageCount).then(async (sentiment) => {
            log.info("Sentiment analysis result", { isUnhappy: sentiment.isUnhappy, urgency: sentiment.urgency });
            if (!sentiment.isUnhappy)
                return;
            await (0, slack_js_1.sendUnhappyAlert)({
                country: listing?.country ?? "",
                guestName: reservation.guestName,
                listingTitle: listing?.title ?? "Unknown",
                checkIn: reservation.checkIn,
                checkOut: reservation.checkOut,
                source: reservation.source,
                messageCount,
                sentiment,
            });
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
            await handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment: false });
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
            await handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment: true });
            return;
        }
        log.info("Unknown event type, skipping", { eventType });
    }
    catch (err) {
        log.error("Webhook handler error", { error: String(err) });
    }
}
