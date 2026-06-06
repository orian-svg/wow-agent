import { createLogger } from "./logger.js";
import { Redis } from "@upstash/redis";

const log = createLogger("memory");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export type Urgency = "low" | "medium" | "high" | "resolved";

interface ReservationMemory {
  sentOpportunities: string[];
  lastUnhappyUrgency?: Urgency;
  lastUnhappyIssue?: string;
  lastUnhappyOpenedAt?: string;
  unhappySlackTs?: string;
  manuallyResolved?: boolean;
  manuallyResolvedAt?: string;
  resolvedSlackSent?: boolean;
  wowSlackTs?: string;
  conversationMessages?: string;
  conversationLastUpdated?: string;
  guestName?: string;
  listingNickname?: string;
  country?: string;
  checkIn?: string;
  checkOut?: string;
  source?: string;
  lastUpdated?: string;
}

async function getRecord(reservationId: string): Promise<ReservationMemory> {
  try {
    const data = await redis.get<ReservationMemory>(`res:${reservationId}`);
    return data ?? { sentOpportunities: [] };
  } catch {
    log.warn(`Could not read from Redis for ${reservationId}`);
    return { sentOpportunities: [] };
  }
}

async function setRecord(reservationId: string, data: ReservationMemory): Promise<void> {
  try {
    await redis.set(`res:${reservationId}`, data, { ex: 60 * 60 * 24 * 30 });
  } catch (err) {
    log.error(`Could not write to Redis for ${reservationId}`, { error: String(err) });
  }
}

export async function getPastOpportunities(reservationId: string): Promise<string[]> {
  const data = await getRecord(reservationId);
  return data.sentOpportunities ?? [];
}

export async function recordOpportunity(reservationId: string, why: string): Promise<void> {
  const data = await getRecord(reservationId);
  data.sentOpportunities = [...(data.sentOpportunities ?? []), why];
  await setRecord(reservationId, data);
  log.info(`Recorded opportunity for reservation ${reservationId}`);
}

export const URGENCY_RANK: Record<Urgency, number> = {
  resolved: -1,
  low: 0,
  medium: 1,
  high: 2,
};

export async function getLastUnhappyUrgency(reservationId: string): Promise<Urgency | undefined> {
  const data = await getRecord(reservationId);
  return data.lastUnhappyUrgency;
}

export async function getUnhappyThreadTs(reservationId: string): Promise<string | undefined> {
  const data = await getRecord(reservationId);
  return data.unhappySlackTs;
}

export async function getLastUnhappyIssue(reservationId: string): Promise<string | undefined> {
  const data = await getRecord(reservationId);
  return data.lastUnhappyIssue;
}

export async function isManuallyResolved(reservationId: string): Promise<boolean> {
  const data = await getRecord(reservationId);
  return data.manuallyResolved === true;
}

export async function markManuallyResolved(reservationId: string): Promise<void> {
  const data = await getRecord(reservationId);
  data.manuallyResolved = true;
  data.manuallyResolvedAt = new Date().toISOString();
  data.lastUnhappyUrgency = "resolved";
  await setRecord(reservationId, data);
  log.info(`Reservation ${reservationId} manually marked as resolved`);
}

export async function isResolvedSlackSent(reservationId: string): Promise<boolean> {
  const data = await getRecord(reservationId);
  return data.resolvedSlackSent === true;
}

export async function markResolvedSlackSent(reservationId: string): Promise<void> {
  const data = await getRecord(reservationId);
  data.resolvedSlackSent = true;
  await setRecord(reservationId, data);
}

export async function recordUnhappyAlert(
  reservationId: string,
  urgency: Urgency,
  slackTs?: string,
  issue?: string
): Promise<void> {
  const data = await getRecord(reservationId);
  data.lastUnhappyUrgency = urgency;
  if (slackTs) data.unhappySlackTs = slackTs;
  if (issue) {
    data.lastUnhappyIssue = issue;
    if (!data.lastUnhappyOpenedAt || urgency === "resolved") {
      data.lastUnhappyOpenedAt = new Date().toISOString();
    }
  }
  if (urgency === "resolved") {
    data.manuallyResolved = false;
    data.lastUnhappyOpenedAt = undefined;
  } else {
    data.resolvedSlackSent = false;
  }
  await setRecord(reservationId, data);
  log.info(`Recorded unhappy alert for reservation ${reservationId} (urgency: ${urgency})`);
}

export async function getWowThreadTs(reservationId: string): Promise<string | undefined> {
  const data = await getRecord(reservationId);
  return data.wowSlackTs;
}

export async function recordWowAlert(
  reservationId: string,
  slackTs?: string
): Promise<void> {
  const data = await getRecord(reservationId);
  if (slackTs) data.wowSlackTs = slackTs;
  await setRecord(reservationId, data);
}

export async function saveConversation(
  reservationId: string,
  messages: string,
  meta: {
    guestName: string;
    listingNickname: string;
    country: string;
    checkIn: string;
    checkOut: string;
    source: string;
  }
): Promise<void> {
  const data = await getRecord(reservationId);
  data.conversationMessages = messages;
  data.conversationLastUpdated = new Date().toISOString();
  data.guestName = meta.guestName;
  data.listingNickname = meta.listingNickname;
  data.country = meta.country;
  data.checkIn = meta.checkIn;
  data.checkOut = meta.checkOut;
  data.source = meta.source;
  data.lastUpdated = new Date().toISOString();
  await setRecord(reservationId, data);
}

export async function getAllActiveConversations(sinceIso?: string): Promise<Array<{
  reservationId: string;
  messages: string;
  guestName: string;
  listingNickname: string;
  country: string;
  checkIn: string;
  checkOut: string;
  source: string;
  lastUpdated: string;
  lastUnhappyUrgency?: Urgency;
  lastUnhappyOpenedAt?: string;
  manuallyResolved?: boolean;
  conversationLastUpdated?: string;
}>> {
  try {
    const keys = await redis.keys("res:*");
    const results = [];

    for (const key of keys) {
      const data = await redis.get<ReservationMemory>(key);
      if (!data?.conversationMessages || !data?.guestName) continue;

      if (data.checkOut) {
        const checkOut = new Date(data.checkOut);
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        if (checkOut < twoDaysAgo) continue;
      }

      if (sinceIso && data.conversationLastUpdated) {
        const hasActiveIssue = data.lastUnhappyUrgency && data.lastUnhappyUrgency !== "resolved";
        const updatedAfter = new Date(data.conversationLastUpdated) > new Date(sinceIso);
        if (!updatedAfter && !hasActiveIssue) continue;
      }

      const reservationId = key.replace("res:", "");
      results.push({
        reservationId,
        messages: data.conversationMessages,
        guestName: data.guestName,
        listingNickname: data.listingNickname ?? "Unknown",
        country: data.country ?? "",
        checkIn: data.checkIn ?? "",
        checkOut: data.checkOut ?? "",
        source: data.source ?? "",
        lastUpdated: data.lastUpdated ?? "",
        lastUnhappyUrgency: data.lastUnhappyUrgency,
        lastUnhappyOpenedAt: data.lastUnhappyOpenedAt,
        manuallyResolved: data.manuallyResolved,
        conversationLastUpdated: data.conversationLastUpdated,
      });
    }

    return results;
  } catch (err) {
    log.error("Failed to get active conversations from Redis", { error: String(err) });
    return [];
  }
}

const LAST_EVENING_REPORT_KEY = "meta:lastEveningReport";

export async function setLastEveningReportTime(): Promise<void> {
  try {
    await redis.set(LAST_EVENING_REPORT_KEY, new Date().toISOString());
  } catch (err) {
    log.error("Failed to save evening report time", { error: String(err) });
  }
}

export async function getLastEveningReportTime(): Promise<string | null> {
  try {
    const val = await redis.get<string>(LAST_EVENING_REPORT_KEY);
    return val ?? null;
  } catch {
    return null;
  }
}