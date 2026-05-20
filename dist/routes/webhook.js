"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookHandler = webhookHandler;
const logger_js_1 = require("../lib/logger.js");
const guesty_js_1 = require("../services/guesty.js");
const slack_js_1 = require("../services/slack.js");
const analyzer_js_1 = require("../services/analyzer.js");
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
async function handleAnalysis({ reservationId, guestMessages, reservation, listing, status, }) {
    // שלב 1: בדוק מה כבר נשלח עבור ההזמנה הזו
    const pastOpportunities = (0, memory_js_1.getPastOpportunities)(reservationId);
    const analysis = await (0, analyzer_js_1.analyze)(reservation.guestName, guestMessages, pastOpportunities);
    log.info("Analysis result", { isOpportunity: analysis.isOpportunity });
    if (!analysis.isOpportunity) {
        log.info("No new opportunity identified");
        return;
    }
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
    // שמור שנשלחה המלצה כדי לא לחזור עליה
    (0, memory_js_1.recordOpportunity)(reservationId, analysis.why);
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
        // שלב 3: אם אין reservationId — לא עושים כלום
        if (!reservationId) {
            log.info("No reservationId found, skipping");
            return;
        }
        // --- מסלול 1: reservation.updated ---
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
            const listing = reservation.listingId
                ? await (0, guesty_js_1.getListing)(reservation.listingId)
                : null;
            const status = formatStatus(reservation.status, reservation.isReturningGuest);
            log.info("Context resolved", {
                guestName: reservation.guestName,
                listingTitle: listing?.title ?? "Unknown",
                country: listing?.country ?? "",
                status,
            });
            await handleAnalysis({ reservationId, guestMessages, reservation, listing, status });
            return;
        }
        // --- מסלול 2: reservation.messageReceived ---
        // שלב 2: מנתח כל הודעה (לא רק אורחים חוזרים)
        if (eventType === "reservation.messageReceived") {
            const conversation = event?.conversation ?? {};
            const thread = conversation.thread ?? [];
            const guestMessages = extractMessagesFromThread(thread);
            if (!guestMessages) {
                log.info("No guest messages found, skipping");
                return;
            }
            const reservation = await (0, guesty_js_1.getReservation)(reservationId);
            if (!reservation)
                return;
            const listing = reservation.listingId
                ? await (0, guesty_js_1.getListing)(reservation.listingId)
                : null;
            const status = formatStatus(reservation.status, reservation.isReturningGuest);
            log.info("Context resolved", {
                guestName: reservation.guestName,
                listingTitle: listing?.title ?? "Unknown",
                country: listing?.country ?? "",
                status,
                isReturningGuest: reservation.isReturningGuest,
            });
            await handleAnalysis({ reservationId, guestMessages, reservation, listing, status });
            return;
        }
        log.info("Unknown event type, skipping", { eventType });
    }
    catch (err) {
        log.error("Webhook handler error", { error: String(err) });
    }
}
