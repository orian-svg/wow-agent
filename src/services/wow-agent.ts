import { createLogger } from "../lib/logger.js";
import { getListing, getReservation, getConversation, getGuestHistory } from "./guesty.js";
import { buildAlertParams, sendAlert } from "./slack.js";
import { analyze } from "./analyzer.js";
import { getPastOpportunities, recordOpportunity, getWowThreadTs, recordWowAlert, saveConversation } from "../lib/memory.js";
import type { GuestyMessage } from "../types.js";

const log = createLogger("wow-agent");

const INQUIRY_SOURCES = ["airbnb", "airbnb2", "vrbo"];

export function isInquiryStatus(status: string): boolean {
  return ["inquiry", "reserved", "pending"].includes(status.toLowerCase());
}

export function isInquirySource(source: string): boolean {
  return INQUIRY_SOURCES.includes(source.toLowerCase());
}

export function shouldRunWow(reservation: {
  status: string;
  source: string;
  isReturningGuest: boolean;
}): boolean {
  if (reservation.isReturningGuest) return true;
  if (isInquiryStatus(reservation.status) && isInquirySource(reservation.source)) return false;
  return true;
}

export async function handleWow({
  reservationId,
  guestMessages,
  reservation,
  listing,
  status,
}: {
  reservationId: string;
  guestMessages: string;
  reservation: { guestId: string; guestName: string; checkIn: string; checkOut: string; source: string; status: string; isReturningGuest: boolean };
  listing: { country: string; title: string } | null;
  status: string;
}): Promise<void> {
  const pastOpportunities = await getPastOpportunities(reservationId);

  let guestHistory = "";
  if (reservation.guestId) {
    guestHistory = await getGuestHistory(reservation.guestId);
    if (guestHistory) {
      log.info(`Guest history loaded for ${reservation.guestName} (${guestHistory.length} chars)`);
    }
  }

  const analysis = await analyze(reservation.guestName, guestMessages, pastOpportunities, guestHistory);
  log.info("WOW analysis result", { isOpportunity: analysis.isOpportunity });

  if (!analysis.isOpportunity) return;

  const wowThreadTs = await getWowThreadTs(reservationId);

  const alertParams = buildAlertParams({
    country: listing?.country ?? "",
    guestName: reservation.guestName,
    listingTitle: listing?.title ?? "Unknown",
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    source: reservation.source,
    status,
    material: analysis.material,
    personal: analysis.personal,
    why: analysis.why,
  });

  const ts = await sendAlert(alertParams, wowThreadTs);
  await recordOpportunity(reservationId, analysis.why);
  if (!wowThreadTs && ts) await recordWowAlert(reservationId, ts);
}
