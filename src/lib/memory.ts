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
  unhappySlackTs?: string;
  conversationMessages?: string;
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
    // שמירה ל-30 יום
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

export async function recordUnhappyAlert(
  reservationId: string,
  urgency: Urgency,
  slackTs?: string
): Promise<void> {
  const data = await getRecord(reservationId);
  data.lastUnhappyUrgency = urgency;
  if (slackTs) data.unhappySlackTs = slackTs;
  await setRecord(reservationId, data);
  log.info(`Recorded unhappy alert for reservation ${reservationId} (urgency: ${urgency})`);
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
  data.guestName = meta.guestName;
  data.listingNickname = meta.listingNickname;
  data.country = meta.country;
  data.checkIn = meta.checkIn;
  data.checkOut = meta.checkOut;
  data.source = meta.source;
  data.lastUpdated = new Date().toISOString();
  await setRecord(reservationId, data);
}

export async function getAllActiveConversations(): Promise<Array<{
  reservationId: string;
  messages: string;
  guestName: string;
  listingNickname: string;
  country: string;
  checkIn: string;
  checkOut: string;
  source: string;
  lastUpdated: string;
}>> {
  try {
    const keys = await redis.keys("res:*");
    const results = [];

    for (const key of keys) {
      const data = await redis.get<ReservationMemory>(key);
      if (!data?.conversationMessages || !data?.guestName) continue;

      // מסנן הזמנות שהצ'ק-אאוט עבר יותר מ-2 ימים
      if (data.checkOut) {
        const checkOut = new Date(data.checkOut);
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        if (checkOut < twoDaysAgo) continue;
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
      });
    }

    return results;
  } catch (err) {
    log.error("Failed to get active conversations from Redis", { error: String(err) });
    return [];
  }
}