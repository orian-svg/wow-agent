"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveChannel = resolveChannel;
exports.buildAlertParams = buildAlertParams;
exports.sendAlert = sendAlert;
const config_js_1 = require("../config.js");
const logger_js_1 = require("../lib/logger.js");
const log = (0, logger_js_1.createLogger)("slack");
function channelForCountry(country) {
    const normalized = country.trim().toLowerCase();
    if (normalized === "greece" || normalized === "gr") {
        return config_js_1.config.slackChannelAthens;
    }
    return config_js_1.config.slackChannelIsrael;
}
function formatDate(iso) {
    if (!iso)
        return "Unknown";
    try {
        return new Date(iso).toLocaleDateString("en-US", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }
    catch {
        return iso;
    }
}
function formatSource(source) {
    if (!source)
        return "Unknown";
    const map = {
        airbnb: "Airbnb",
        airbnb2: "Airbnb",
        "booking.com": "Booking.com",
        bookingcom: "Booking.com",
        expedia: "Expedia",
        vrbo: "VRBO",
        manual: "Manual/Website",
        website: "Manual/Website",
    };
    const key = source.toLowerCase();
    return map[key] ?? source;
}
function resolveChannel(country) {
    return channelForCountry(country);
}
function buildAlertParams(input) {
    return {
        channel: channelForCountry(input.country),
        guestName: input.guestName,
        listingTitle: input.listingTitle,
        checkIn: formatDate(input.checkIn),
        checkOut: formatDate(input.checkOut),
        source: formatSource(input.source),
        what: input.what,
        why: input.why,
    };
}
async function sendAlert(params) {
    const text = [
        "*WOW Opportunity* 🌟",
        "",
        `*Guest:* ${params.guestName}`,
        `*Listing:* ${params.listingTitle}`,
        `*Check-in:* ${params.checkIn}`,
        `*Check-out:* ${params.checkOut}`,
        `*Source:* ${params.source}`,
        "",
        "*What:*",
        params.what,
        "",
        "*Why:*",
        params.why,
    ].join("\n");
    const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config_js_1.config.slackBotToken}`,
        },
        body: JSON.stringify({ channel: params.channel, text }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Slack API failed (${response.status}): ${body}`);
    }
    const data = (await response.json());
    if (!data.ok) {
        throw new Error(`Slack returned error: ${data.error}`);
    }
    log.info(`Alert sent to ${params.channel}`);
}
