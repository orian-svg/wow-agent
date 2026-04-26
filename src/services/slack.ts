import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import type { SlackAlertParams } from "../types.js";

const log = createLogger("slack");

function channelForCountry(country: string): string {
  const normalized = country.trim().toLowerCase();
  if (normalized === "greece" || normalized === "gr") {
    return config.slackChannelAthens;
  }
  return config.slackChannelIsrael;
}

function formatDate(iso: string | null): string {
  if (!iso) return "לא ידוע";
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatSource(source: string): string {
  const map: Record<string, string> = {
    airbnb: "Airbnb",
    airbnb2: "Airbnb",
    "booking.com": "Booking.com",
    bookingcom: "Booking.com",
    manual: "Website",
    website: "Website",
    vrbo: "VRBO",
  };
  const key = source.toLowerCase();
  return map[key] ?? source;
}

export function resolveChannel(country: string): string {
  return channelForCountry(country);
}

export function buildAlertParams(input: {
  country: string;
  guestName: string;
  listingTitle: string;
  checkIn: string | null;
  checkOut: string | null;
  source: string | null;
  what: string;
  why: string;
}): SlackAlertParams {
  return {
    channel: channelForCountry(input.country),
    guestName: input.guestName,
    listingTitle: input.listingTitle,
    checkIn: formatDate(input.checkIn),
    checkOut: formatDate(input.checkOut),
    source: formatSource(input.source ?? "unknown"),
    what: input.what,
    why: input.why,
  };
}

export async function sendAlert(params: SlackAlertParams): Promise<void> {
  const text = [
    "*WOW Opportunity* 🌟",
    "",
    `*שם אורח:* ${params.guestName}`,
    `*דירה:* ${params.listingTitle}`,
    `*תאריכים:* ${params.checkIn} — ${params.checkOut}`,
    `*ספק:* ${params.source}`,
    "",
    "*מה ההזדמנות:*",
    params.what,
    "",
    "*למה זו הזדמנות:*",
    params.why,
  ].join("\n");

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.slackBotToken}`,
    },
    body: JSON.stringify({ channel: params.channel, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack API failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack returned error: ${data.error}`);
  }

  log.info(`Alert sent to ${params.channel}`);
}