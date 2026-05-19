import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { getListing, getReservation, getConversation } from "../services/guesty.js";
import { buildAlertParams, sendAlert } from "../services/slack.js";
import { analyze } from "../services/analyzer.js";
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

  const confirmedStatuses = ["confirmed", "inquiry", "reserved"];
  const wasInquiry = ["inquiry", "reserved", "pending"].includes(oldStatus.toLowerCase());
  const isNowConfirmed = newStatus.toLowerCase() === "confirmed";

  return wasInquiry && isNowConfirmed;
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

    // --- מסלול 1: reservation.updated ---
    // מנתח רק אם ההזמנה עברה מ-inquiry ל-confirmed
    if (eventType === "reservation.updated") {
      if (!wasJustConfirmed(event)) {
        log.info("reservation.updated but not a confirmation transition, skipping");
        return;
      }

      log.info("Reservation just confirmed — analyzing full conversation");

      if (!reservationId) {
        log.warn("No reservationId in reservation.updated event, skipping");
        return;
      }

      const reservation = await getReservation(reservationId);
      if (!reservation) return;

      // נסה לקחת שיחה מה-thread של ה-event, אחרת קרא מגסטי
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

      const analysis = await analyze(reservation.guestName, guestMessages);
      log.info("Analysis result", { isOpportunity: analysis.isOpportunity });

      if (!analysis.isOpportunity) {
        log.info("No opportunity identified");
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
      return;
    }

    // --- מסלול 2: reservation.messageReceived ---
    // מנתח רק אם אורח חוזר
    if (eventType === "reservation.messageReceived") {
      const conversation = event?.conversation ?? {};
      const thread: GuestyMessage[] = conversation.thread ?? [];
      const meta = conversation.meta ?? {};
      const firstReservation = meta.reservations?.[0];

      const guestMessages = extractMessagesFromThread(thread);

      if (!guestMessages) {
        log.info("No guest messages found, skipping");
        return;
      }

      // אם אין reservationId — לא יכולים לבדוק אם אורח חוזר, מדלגים
      if (!reservationId) {
        log.info("No reservationId in messageReceived event, skipping");
        return;
      }

      const reservation = await getReservation(reservationId);
      if (!reservation) return;

      // מנתח הודעות רק אם אורח חוזר
      if (!reservation.isReturningGuest) {
        log.info("Not a returning guest, skipping message analysis");
        return;
      }

      log.info("Returning guest — analyzing message");

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

      const analysis = await analyze(reservation.guestName, guestMessages);
      log.info("Analysis result", { isOpportunity: analysis.isOpportunity });

      if (!analysis.isOpportunity) {
        log.info("No opportunity identified");
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
      return;
    }

    log.info("Unknown event type, skipping", { eventType });

  } catch (err) {
    log.error("Webhook handler error", { error: String(err) });
  }
}