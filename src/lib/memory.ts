import { createLogger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";

const log = createLogger("memory");

const MEMORY_FILE = path.resolve("./data/memory.json");

interface ReservationMemory {
  sentOpportunities: string[]; // free-text descriptions of what was already sent
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