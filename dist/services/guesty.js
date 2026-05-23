"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getListing = getListing;
exports.getReservation = getReservation;
exports.getConversation = getConversation;
exports.getGuestHistory = getGuestHistory;
const config_js_1 = require("../config.js");
const cache_js_1 = require("../lib/cache.js");
const logger_js_1 = require("../lib/logger.js");
const log = (0, logger_js_1.createLogger)("guesty");
const TOKEN_CACHE = new cache_js_1.Cache(1380);
const LISTING_CACHE = new cache_js_1.Cache(60);
const RESERVATION_CACHE = new cache_js_1.Cache(10);
const GUEST_HISTORY_CACHE = new cache_js_1.Cache(60);
const TOKEN_KEY = "current";
let pendingTokenRequest = null;
async function fetchNewToken() {
    const response = await fetch("https://open-api.guesty.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "open-api",
            client_id: config_js_1.config.guestyClientId,
            client_secret: config_js_1.config.guestyClientSecret,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Guesty token request failed (${response.status}): ${text}`);
    }
    const data = (await response.json());
    if (!data.access_token) {
        throw new Error("Guesty token response missing access_token");
    }
    log.debug("New Guesty token obtained");
    return data.access_token;
}
async function getToken() {
    const cached = TOKEN_CACHE.get(TOKEN_KEY);
    if (cached)
        return cached;
    if (pendingTokenRequest) {
        log.debug("Token request already in flight, waiting");
        return pendingTokenRequest;
    }
    pendingTokenRequest = (async () => {
        try {
            const token = await fetchNewToken();
            TOKEN_CACHE.set(TOKEN_KEY, token);
            return token;
        }
        finally {
            pendingTokenRequest = null;
        }
    })();
    return pendingTokenRequest;
}
async function guestyGet(path) {
    const token = await getToken();
    const response = await fetch(`https://open-api.guesty.com${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
        log.warn("Got 401, clearing token cache and retrying once");
        TOKEN_CACHE.clear();
        const freshToken = await getToken();
        const retry = await fetch(`https://open-api.guesty.com${path}`, {
            headers: { Authorization: `Bearer ${freshToken}` },
        });
        if (!retry.ok) {
            const text = await retry.text();
            throw new Error(`Guesty ${path} failed after retry (${retry.status}): ${text}`);
        }
        return retry.json();
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Guesty ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
}
async function getListing(listingId) {
    const cached = LISTING_CACHE.get(listingId);
    if (cached) {
        log.debug(`Listing ${listingId} served from cache`);
        return cached;
    }
    try {
        const data = (await guestyGet(`/v1/listings/${listingId}`));
        const listing = {
            id: data._id,
            title: data.title ?? "Unknown",
            country: data.address?.country ?? "",
            city: data.address?.city ?? "",
        };
        LISTING_CACHE.set(listingId, listing);
        log.info(`Listing ${listingId} loaded: ${listing.title} (${listing.country})`);
        return listing;
    }
    catch (err) {
        log.error(`Failed to load listing ${listingId}`, { error: String(err) });
        return null;
    }
}
async function getReservation(reservationId) {
    const cached = RESERVATION_CACHE.get(reservationId);
    if (cached) {
        log.debug(`Reservation ${reservationId} served from cache`);
        return cached;
    }
    try {
        const data = (await guestyGet(`/v1/reservations/${reservationId}`));
        const firstName = data.guest?.firstName ?? "";
        const lastName = data.guest?.lastName ?? "";
        const fullName = data.guest?.fullName ?? "";
        const combinedName = `${firstName} ${lastName}`.trim();
        const guestName = fullName || combinedName || "Guest";
        const reservation = {
            id: data._id,
            guestId: data.guest?._id ?? "",
            listingId: data.listingId ?? "",
            checkIn: data.checkIn ?? "",
            checkOut: data.checkOut ?? "",
            source: data.source ?? "unknown",
            status: data.status ?? "unknown",
            isReturningGuest: data.isReturningGuest ?? false,
            guestName,
        };
        RESERVATION_CACHE.set(reservationId, reservation);
        log.info(`Reservation ${reservationId} loaded (status: ${reservation.status}, returning: ${reservation.isReturningGuest}, guestId: ${reservation.guestId})`);
        return reservation;
    }
    catch (err) {
        log.error(`Failed to load reservation ${reservationId}`, { error: String(err) });
        return null;
    }
}
async function getConversation(conversationId) {
    try {
        const data = (await guestyGet(`/v1/communication/conversations/${conversationId}`));
        const messages = (data.thread ?? [])
            .filter((m) => m.type === "fromGuest")
            .map((m) => m.body ?? "")
            .filter((b) => b.trim().length > 0)
            .join("\n");
        log.info(`Conversation ${conversationId} loaded (${messages.length} chars)`);
        return messages;
    }
    catch (err) {
        log.error(`Failed to load conversation ${conversationId}`, { error: String(err) });
        return "";
    }
}
// שולף את כל השיחות ההיסטוריות של אורח לפי מזהה האורח
async function getGuestHistory(guestId) {
    if (!guestId)
        return "";
    const cached = GUEST_HISTORY_CACHE.get(guestId);
    if (cached) {
        log.debug(`Guest history for ${guestId} served from cache`);
        return cached;
    }
    try {
        const filters = JSON.stringify([{ field: "guest._id", operator: "$eq", value: guestId }]);
        const data = (await guestyGet(`/v1/communication/conversations?filters=${encodeURIComponent(filters)}&limit=20&sort=-createdAt`));
        const conversations = data.results ?? [];
        const history = conversations
            .map((conv) => {
            const messages = (conv.thread ?? [])
                .filter((m) => m.type === "fromGuest")
                .map((m) => m.body ?? "")
                .filter((b) => b.trim().length > 0)
                .join("\n");
            return messages;
        })
            .filter((m) => m.length > 0)
            .join("\n---\n");
        GUEST_HISTORY_CACHE.set(guestId, history);
        log.info(`Guest history for ${guestId} loaded (${conversations.length} conversations, ${history.length} chars)`);
        return history;
    }
    catch (err) {
        log.error(`Failed to load guest history for ${guestId}`, { error: String(err) });
        return "";
    }
}
