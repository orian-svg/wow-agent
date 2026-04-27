import { config } from "../config.js";
import { Cache } from "../lib/cache.js";
import { createLogger } from "../lib/logger.js";
import type { GuestyListing, GuestyReservation } from "../types.js";

const log = createLogger("guesty");

const TOKEN_CACHE = new Cache<string>(20);
const LISTING_CACHE = new Cache<GuestyListing>(60);
const RESERVATION_CACHE = new Cache<GuestyReservation>(10);

const TOKEN_KEY = "current";

let pendingTokenRequest: Promise<string> | null = null;

async function fetchNewToken(): Promise<string> {
  const response = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "open-api",
      client_id: config.guestyClientId,
      client_secret: config.guestyClientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Guesty token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Guesty token response missing access_token");
  }

  log.debug("New Guesty token obtained");
  return data.access_token;
}

async function getToken(): Promise<string> {
  const cached = TOKEN_CACHE.get(TOKEN_KEY);
  if (cached) return cached;

  if (pendingTokenRequest) {
    log.debug("Token request already in flight, waiting");
    return pendingTokenRequest;
  }

  pendingTokenRequest = (async () => {
    try {
      const token = await fetchNewToken();
      TOKEN_CACHE.set(TOKEN_KEY, token);
      return token;
    } finally {
      pendingTokenRequest = null;
    }
  })();

  return pendingTokenRequest;
}

async function guestyGet(path: string): Promise<unknown> {
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

export async function getListing(listingId: string): Promise<GuestyListing | null> {
  const cached = LISTING_CACHE.get(listingId);
  if (cached) {
    log.debug(`Listing ${listingId} served from cache`);
    return cached;
  }

  try {
    const data = (await guestyGet(`/v1/listings/${listingId}`)) as {
      _id: string;
      title?: string;
      address?: { country?: string; city?: string };
    };

    const listing: GuestyListing = {
      id: data._id,
      title: data.title ?? "Unknown",
      country: data.address?.country ?? "",
      city: data.address?.city ?? "",
    };

    LISTING_CACHE.set(listingId, listing);
    log.info(`Listing ${listingId} loaded: ${listing.title} (${listing.country})`);
    return listing;
  } catch (err) {
    log.error(`Failed to load listing ${listingId}`, { error: String(err) });
    return null;
  }
}

export async function getReservation(
  reservationId: string,
): Promise<GuestyReservation | null> {
  const cached = RESERVATION_CACHE.get(reservationId);
  if (cached) {
    log.debug(`Reservation ${reservationId} served from cache`);
    return cached;
  }

  try {
    const data = (await guestyGet(`/v1/reservations/${reservationId}`)) as {
      _id: string;
      listingId?: string;
      checkIn?: string;
      checkOut?: string;
      source?: string;
      guest?: { fullName?: string; firstName?: string; lastName?: string };
    };

    const reservation: GuestyReservation = {
      id: data._id,
      listingId: data.listingId ?? "",
      checkIn: data.checkIn ?? "",
      checkOut: data.checkOut ?? "",
      source: data.source ?? "unknown",
      guestName:
        data.guest?.fullName ??
        `${data.guest?.firstName ?? ""} ${data.guest?.lastName ?? ""}`.trim() ??
        "Guest",
    };

    RESERVATION_CACHE.set(reservationId, reservation);
    log.info(`Reservation ${reservationId} loaded`);
    return reservation;
  } catch (err) {
    log.error(`Failed to load reservation ${reservationId}`, { error: String(err) });
    return null;
  }
}