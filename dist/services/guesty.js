"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getListing = getListing;
exports.getReservation = getReservation;
const config_js_1 = require("../config.js");
const cache_js_1 = require("../lib/cache.js");
const logger_js_1 = require("../lib/logger.js");
const log = (0, logger_js_1.createLogger)("guesty");
const TOKEN_CACHE = new cache_js_1.Cache(20);
const LISTING_CACHE = new cache_js_1.Cache(60);
const RESERVATION_CACHE = new cache_js_1.Cache(10);
const TOKEN_KEY = "current";
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
    const token = await fetchNewToken();
    TOKEN_CACHE.set(TOKEN_KEY, token);
    return token;
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
        const reservation = {
            id: data._id,
            listingId: data.listingId ?? "",
            checkIn: data.checkIn ?? "",
            checkOut: data.checkOut ?? "",
            source: data.source ?? "unknown",
            guestName: data.guest?.fullName ??
                `${data.guest?.firstName ?? ""} ${data.guest?.lastName ?? ""}`.trim() ??
                "Guest",
        };
        RESERVATION_CACHE.set(reservationId, reservation);
        log.info(`Reservation ${reservationId} loaded`);
        return reservation;
    }
    catch (err) {
        log.error(`Failed to load reservation ${reservationId}`, { error: String(err) });
        return null;
    }
}
