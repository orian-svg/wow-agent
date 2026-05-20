import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { getListing, getReservation, getConversation } from "../services/guesty.js";
import { buildAlertParams, sendAlert } from "../services/slack.js";
import { analyze } from "../services/analyzer.js";
import { getPastOpportunities, recordOpportunity } from "../lib/memory.js";
import type { GuestyMessage, WebhookContext } from "../types.js";

const log = createLogger("webhook");

function formatStatus(status: string, isReturningGuest: boolean): string {
  if (isReturningGuest) return "Returning Guest";
  const map: Record<string, string> = {
    inquiry: "Inquiry",
    reserved: "Inquiry",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    checked_out: "Checked Out",
    cancelled: "Cancelled",
  };
  return map[status.toLowerCase()] ?? status;
}

function extractMessagesFromThread(thread: GuestyMessage[]): string {
  return thread
    .filter((m) => m.type === "fromGuest")
    .map((m) => m.body)
    .filter((b) => typeof b === "string" && b.trim().length > 0)
    .join("\n");
}

function extractReservationId(event: any): string | null {
  const conversation = event?.conversation ?? {};
  const meta = conversation.meta ?? {};
  const firstReservation = meta.reservations?.[0];

  return (
    event?.reservationId ??
    event?.reservation?._id ??
    firstReservation?._id ??
    conversation.reservationId ??
    null
  );
}

function extractConversationId(event: any): string | null {
  const conversation = event?.conversation ?? {};
  return conversation._id ?? event?.conversationId ?? null;
}

function wasJustConfirmed(event: any): boolean {
  const newStatus = event?.reservation?.status ?? event?.data?.reservation?.status ?? "";
  const oldStatus =
    event?.reservationBefore?.status ??
    event?.data?.reservationBefore?.status ??
    "";

  const wasInquiry = ["inquiry", "reserved", "pending"].includes(oldStatus.toLowerCase());
  const isNowConfirmed = newStatus.toLowerCase() === "confirmed";

  return wasInquiry && isNowConfirmed;
}

async function handleAnalysis({
  reservationId,
  guestMessages,
  reservation,
  listing,
  status,
}: {
  reservationId: string;
  guestMessages: string;
  reservation: { guestName: string; checkIn: string; checkOut: string; source: string; status: string };
  listing: { country: string; title: string } | null;
  status: string;
}): Promise<void> {
  // שלב 1: בדוק מה כבר נשלח עבור ההזמנה הזו
  const pastOpportunities = getPastOpportunities(reservationId);

  const analysis = await analyze(reservation.guestName, guestMessages, pastOpportunities);
  log.info("Analysis result", { isOpportunity: analysis.isOpportunity });

  if (!analysis.isOpportunity) {
    log.info("No new opportunity identified");
    return;
  }

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

  await sendAlert(alertParams);

  // שמור שנשלחה המלצה כדי לא לחזור עליה
  recordOpportunity(reservationId, analysis.why);
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  res.sendStatus(200);

  try {
    const event = req.body;
    const eventType = event?.event ?? "";

    log.info("Webhook received", { eventType });
    log.debug("Full payload", JSON.stringify(event).substring(0, 500));

    const reservationId = extractReservationId(event);
    const conversationId = extractConversationId(event);

    // שלב 3: אם אין reservationId — לא עושים כלום
    if (!reservationId) {
      log.info("No reservationId found, skipping");
      return;
    }

    // --- מסלול 1: reservation.updated ---
    if (eventType === "reservation.updated") {
      if (!wasJustConfirmed(event)) {
        log.info("reservation.updated but not a confirmation transition, skipping");
        return;
      }

      log.info("Reservation just confirmed — analyzing full conversation");

      const reservation = await getReservation(reservationId);
      if (!reservation) return;

      const thread: GuestyMessage[] = event?.conversation?.thread ?? [];
      let guestMessages = extractMessagesFromThread(thread);

      if (!guestMessages && conversationId) {
        guestMessages = await getConversation(conversationId);
      }

      if (!guestMessages) {
        log.info("No guest messages found in confirmed reservation, skipping");
        return;
      }

      const listing = reservation.listingId
        ? await getListing(reservation.listingId)
        : null;

      const status = formatStatus(reservation.status, reservation.isReturningGuest);

      log.info("Context resolved", {
        guestName: reservation.guestName,
        listingTitle: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        status,
      });

      await handleAnalysis({ reservationId, guestMessages, reservation, listing, status });
      return;
    }

    // --- מסלול 2: reservation.messageReceived ---
    // שלב 2: מנתח כל הודעה (לא רק אורחים חוזרים)
    if (eventType === "reservation.messageReceived") {
      const conversation = event?.conversation ?? {};
      const thread: GuestyMessage[] = conversation.thread ?? [];

      const guestMessages = extractMessagesFromThread(thread);

      if (!guestMessages) {
        log.info("No guest messages found, skipping");
        return;
      }

      const reservation = await getReservation(reservationId);
      if (!reservation) return;

      const listing = reservation.listingId
        ? await getListing(reservation.listingId)
        : null;

      const status = formatStatus(reservation.status, reservation.isReturningGuest);

      log.info("Context resolved", {
        guestName: reservation.guestName,
        listingTitle: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        status,
        isReturningGuest: reservation.isReturningGuest,
      });

      await handleAnalysis({ reservationId, guestMessages, reservation, listing, status });
      return;
    }

    log.info("Unknown event type, skipping", { eventType });

  } catch (err) {
    log.error("Webhook handler error", { error: String(err) });
  }
}