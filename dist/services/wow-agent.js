"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInquiryStatus = isInquiryStatus;
exports.isInquirySource = isInquirySource;
exports.shouldRunWow = shouldRunWow;
exports.handleWow = handleWow;
const logger_js_1 = require("../lib/logger.js");
const guesty_js_1 = require("./guesty.js");
const slack_js_1 = require("./slack.js");
const analyzer_js_1 = require("./analyzer.js");
const memory_js_1 = require("../lib/memory.js");
const log = (0, logger_js_1.createLogger)("wow-agent");
const INQUIRY_SOURCES = ["airbnb", "airbnb2", "vrbo"];
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
async function handleWow({ reservationId, guestMessages, reservation, listing, status, }) {
    const pastOpportunities = await (0, memory_js_1.getPastOpportunities)(reservationId);
    let guestHistory = "";
    if (reservation.guestId) {
        guestHistory = await (0, guesty_js_1.getGuestHistory)(reservation.guestId);
        if (guestHistory) {
            log.info(`Guest history loaded for ${reservation.guestName} (${guestHistory.length} chars)`);
        }
    }
    const analysis = await (0, analyzer_js_1.analyze)(reservation.guestName, guestMessages, pastOpportunities, guestHistory);
    log.info("WOW analysis result", { isOpportunity: analysis.isOpportunity });
    if (!analysis.isOpportunity)
        return;
    const wowThreadTs = await (0, memory_js_1.getWowThreadTs)(reservationId);
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
    const ts = await (0, slack_js_1.sendAlert)(alertParams, wowThreadTs);
    await (0, memory_js_1.recordOpportunity)(reservationId, analysis.why);
    if (!wowThreadTs && ts)
        await (0, memory_js_1.recordWowAlert)(reservationId, ts);
}
