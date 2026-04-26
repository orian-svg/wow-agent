"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookHandler = webhookHandler;
const logger_js_1 = require("../lib/logger.js");
const guesty_js_1 = require("../services/guesty.js");
const slack_js_1 = require("../services/slack.js");
const analyzer_js_1 = require("../services/analyzer.js");
const log = (0, logger_js_1.createLogger)("webhook");
function extractContext(event) {
    const conversation = event?.conversation ?? {};
    const thread = conversation.thread ?? [];
    const meta = conversation.meta ?? {};
    const firstReservation = meta.reservations?.[0];
    const guestMessages = thread
        .filter((m) => m.type === "fromGuest")
        .map((m) => m.body)
        .filter((b) => typeof b === "string" && b.trim().length > 0)
        .join("\n");
    const reservationId = event?.reservationId ??
        event?.reservation?._id ??
        firstReservation?._id ??
        conversation.reservationId ??
        null;
    const conversationId = conversation._id ?? event?.conversationId ?? null;
    return {
        reservationId,
        conversationId,
        guestName: meta.guestName ?? firstReservation?.guest?.fullName ?? "Guest",
        guestMessages,
        checkIn: firstReservation?.checkIn ?? null,
        checkOut: firstReservation?.checkOut ?? null,
        source: firstReservation?.source ?? null,
    };
}
async function webhookHandler(req, res) {
    res.sendStatus(200);
    try {
        const event = req.body;
        log.info("Webhook received");
        log.debug("Full payload", event);
        const ctx = extractContext(event);
        log.debug("Extracted context", ctx);
        if (!ctx.guestMessages) {
            log.info("No guest messages found, skipping");
            return;
        }
        let listingTitle = "Unknown";
        let country = "";
        let checkIn = ctx.checkIn;
        let checkOut = ctx.checkOut;
        let source = ctx.source;
        let guestName = ctx.guestName;
        if (ctx.reservationId) {
            const reservation = await (0, guesty_js_1.getReservation)(ctx.reservationId);
            if (reservation) {
                checkIn = checkIn ?? reservation.checkIn;
                checkOut = checkOut ?? reservation.checkOut;
                source = source ?? reservation.source;
                if (guestName === "Guest" && reservation.guestName) {
                    guestName = reservation.guestName;
                }
                if (reservation.listingId) {
                    const listing = await (0, guesty_js_1.getListing)(reservation.listingId);
                    if (listing) {
                        listingTitle = listing.title;
                        country = listing.country;
                    }
                }
            }
        }
        log.info("Context resolved", {
            guestName,
            listingTitle,
            country,
            source,
        });
        const analysis = await (0, analyzer_js_1.analyze)(guestName, ctx.guestMessages);
        log.info("Analysis result", { isOpportunity: analysis.isOpportunity });
        if (!analysis.isOpportunity) {
            log.info("No opportunity identified");
            return;
        }
        const alertParams = (0, slack_js_1.buildAlertParams)({
            country,
            guestName,
            listingTitle,
            checkIn,
            checkOut,
            source,
            what: analysis.what,
            why: analysis.why,
        });
        await (0, slack_js_1.sendAlert)(alertParams);
    }
    catch (err) {
        log.error("Webhook handler error", { error: String(err) });
    }
}
