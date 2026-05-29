import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import type { SlackAlertParams } from "../types.js";
import type { SentimentAnalysis } from "./sentiment.js";

const log = createLogger("slack");

function channelForCountry(country: string): string {
  const normalized = country.trim().toLowerCase();
  if (normalized === "greece" || normalized === "gr") {
    return config.slackChannelAthens;
  }
  return config.slackChannelIsrael;
}

function unhappyChannelForCountry(country: string): string {
  const normalized = country.trim().toLowerCase();
  if (normalized === "greece" || normalized === "gr") {
    return config.slackChannelUnhappyAthens;
  }
  return config.slackChannelUnhappyIsrael;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatSource(source: string | null): string {
  if (!source) return "Unknown";
  const map: Record<string, string> = {
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

function urgencyEmoji(urgency: "low" | "medium" | "high"): string {
  if (urgency === "high") return "🔴";
  if (urgency === "medium") return "🟡";
  return "🟢";
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
  status: string;
  material: string;
  personal: string;
  why: string;
}): SlackAlertParams {
  return {
    channel: channelForCountry(input.country),
    guestName: input.guestName,
    listingTitle: input.listingTitle,
    checkIn: formatDate(input.checkIn),
    checkOut: formatDate(input.checkOut),
    source: formatSource(input.source),
    status: input.status,
    material: input.material,
    personal: input.personal,
    why: input.why,
  };
}

export async function sendAlert(params: SlackAlertParams, threadTs?: string): Promise<string | undefined> {
  const isUpdate = !!threadTs;
  const text = [
    isUpdate ? "*New WOW Opportunity* 🌟" : "*WOW Opportunity* 🌟",
    "",
    `*Guest:* ${params.guestName}`,
    `*Listing:* ${params.listingTitle}`,
    `*Check-in:* ${params.checkIn}`,
    `*Check-out:* ${params.checkOut}`,
    `*Source:* ${params.source}`,
    `*Status:* ${params.status}`,
    "",
    "*Opportunity:*",
    `*Material gesture:* ${params.material}`,
    `*Personal touch:* ${params.personal}`,
    "",
    `*Why:* "${params.why}"`,
  ].join("\n");

  return await postToSlack(params.channel, text, threadTs);
}

export async function sendUnhappyAlert(params: {
  country: string;
  guestName: string;
  listingTitle: string;
  checkIn: string | null;
  checkOut: string | null;
  source: string | null;
  messageCount: number;
  sentiment: SentimentAnalysis;
  threadTs?: string;
}): Promise<string | undefined> {
  const emoji = urgencyEmoji(params.sentiment.urgency);
  const urgencyLabel = params.sentiment.urgency.charAt(0).toUpperCase() + params.sentiment.urgency.slice(1);
  const isUpdate = !!params.threadTs;

  const text = [
    isUpdate
      ? `*Urgency escalated to ${urgencyLabel}* ${emoji}`
      : `*Unhappy Guest* ${emoji}`,
    "",
    `*Guest:* ${params.guestName}`,
    `*Listing:* ${params.listingTitle}`,
    `*Location:* ${params.country || "Unknown"}`,
    `*Check-in:* ${formatDate(params.checkIn)}`,
    `*Check-out:* ${formatDate(params.checkOut)}`,
    `*Source:* ${formatSource(params.source)}`,
    `*Messages in conversation:* ${params.messageCount}`,
    "",
    `*Urgency:* ${urgencyLabel}`,
    `*Guest tone:* ${params.sentiment.guestTone}`,
    `*Issue:* ${params.sentiment.issue}`,
    `*Suggested action:* ${params.sentiment.suggestion}`,
  ].join("\n");

  const channel = unhappyChannelForCountry(params.country);
  return await postToSlack(channel, text, params.threadTs);
}

export async function sendUnhappyResolved(params: {
  country: string;
  guestName: string;
  isFullyResolved: boolean;
  newUrgency?: "low" | "medium" | "high";
  threadTs: string;
}): Promise<void> {
  let text: string;

  if (params.isFullyResolved) {
    text = [
      `*Issue resolved* ✅`,
      "",
      `*Guest:* ${params.guestName}`,
      `Guest appears satisfied — no further action needed.`,
    ].join("\n");
  } else {
    const emoji = urgencyEmoji(params.newUrgency!);
    const urgencyLabel = params.newUrgency!.charAt(0).toUpperCase() + params.newUrgency!.slice(1);
    text = [
      `*Urgency decreased to ${urgencyLabel}* ${emoji}`,
      "",
      `*Guest:* ${params.guestName}`,
      `Situation appears to be improving.`,
    ].join("\n");
  }

  const channel = unhappyChannelForCountry(params.country);
  await postToSlack(channel, text, params.threadTs);
}

async function postToSlack(
  channel: string,
  text: string,
  threadTs?: string
): Promise<string | undefined> {
  const body: Record<string, string> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.slackBotToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Slack API failed (${response.status}): ${responseBody}`);
  }

  const data = (await response.json()) as { ok: boolean; error?: string; ts?: string };
  if (!data.ok) {
    throw new Error(`Slack returned error: ${data.error}`);
  }

  log.info(`Alert sent to ${channel}${threadTs ? " (thread)" : ""}`);
  return data.ts;
}