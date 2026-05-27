import { createLogger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";

const log = createLogger("memory");

const MEMORY_FILE = path.resolve("./data/memory.json");

export type Urgency = "low" | "medium" | "high" | "resolved";

interface ReservationMemory {
  sentOpportunities: string[];
  lastUnhappyUrgency?: Urgency;
  unhappySlackTs?: string;
  conversationMessages?: string; // שיחה מצטברת לדוח
  guestName?: string;
  listingNickname?: string;
  country?: string;
  checkIn?: string;
  checkOut?: string;
  source?: string;
  lastUpdated?: string;
}

type MemoryStore = Record<string, ReservationMemory>;

function loadStore(): MemoryStore {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    return JSON.parse(raw) as MemoryStore;
  } catch {
    log.warn("Could not load memory file, starting fresh");
    return {};
  }
}

function saveStore(store: MemoryStore): void {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    log.error("Could not save memory file", { error: String(err) });
  }
}

export function getPastOpportunities(reservationId: string): string[] {
  const store = loadStore();
  return store[reservationId]?.sentOpportunities ?? [];
}

export function recordOpportunity(reservationId: string, why: string): void {
  const store = loadStore();
  if (!store[reservationId]) {
    store[reservationId] = { sentOpportunities: [] };
  }
  store[reservationId].sentOpportunities.push(why);
  saveStore(store);
  log.info(`Recorded opportunity for reservation ${reservationId}`);
}

export const URGENCY_RANK: Record<Urgency, number> = {
  resolved: -1,
  low: 0,
  medium: 1,
  high: 2,
};

export function getLastUnhappyUrgency(reservationId: string): Urgency | undefined {
  const store = loadStore();
  return store[reservationId]?.lastUnhappyUrgency;
}

export function getUnhappyThreadTs(reservationId: string): string | undefined {
  const store = loadStore();
  return store[reservationId]?.unhappySlackTs;
}

export function recordUnhappyAlert(
  reservationId: string,
  urgency: Urgency,
  slackTs?: string
): void {
  const store = loadStore();
  if (!store[reservationId]) {
    store[reservationId] = { sentOpportunities: [] };
  }
  store[reservationId].lastUnhappyUrgency = urgency;
  if (slackTs) {
    store[reservationId].unhappySlackTs = slackTs;
  }
  saveStore(store);
  log.info(`Recorded unhappy alert for reservation ${reservationId} (urgency: ${urgency})`);
}

// שמירת השיחה המצטברת לדוח היומי
export function saveConversation(
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
): void {
  const store = loadStore();
  if (!store[reservationId]) {
    store[reservationId] = { sentOpportunities: [] };
  }
  store[reservationId].conversationMessages = messages;
  store[reservationId].guestName = meta.guestName;
  store[reservationId].listingNickname = meta.listingNickname;
  store[reservationId].country = meta.country;
  store[reservationId].checkIn = meta.checkIn;
  store[reservationId].checkOut = meta.checkOut;
  store[reservationId].source = meta.source;
  store[reservationId].lastUpdated = new Date().toISOString();
  saveStore(store);
}

// שליפת כל ההזמנות שיש להן שיחה שמורה
export function getAllActiveConversations(): Array<{
  reservationId: string;
  messages: string;
  guestName: string;
  listingNickname: string;
  country: string;
  checkIn: string;
  checkOut: string;
  source: string;
  lastUpdated: string;
}> {
  const store = loadStore();
  const results = [];

  for (const [reservationId, data] of Object.entries(store)) {
    if (!data.conversationMessages || !data.guestName) continue;

    // מסנן הזמנות ישנות שהצ'ק-אאוט שלהן עבר יותר מ-2 ימים
    if (data.checkOut) {
      const checkOut = new Date(data.checkOut);
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      if (checkOut < twoDaysAgo) continue;
    }

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
}