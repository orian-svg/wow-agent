import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { getListing, getReservation, getConversation } from "../services/guesty.js";
import { handleWow, shouldRunWow } from "../services/wow-agent.js";
import { handleUnhappy } from "../services/unhappy-agent.js";
import { saveConversation, markManuallyResolved } from "../lib/memory.js";
import type { GuestyMessage } from "../types.js";

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

function countGuestMessages(thread: GuestyMessage[]): number {
  return thread.filter((m) => m.type === "fromGuest").length;
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

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  res.sendStatus(200);

  try {
    const event = req.body;
    const eventType = event?.event ?? "";

    log.info("Webhook received", { eventType });
    log.debug("Full payload", JSON.stringify(event).substring(0, 500));

    const reservationId = extractReservationId(event);
    const conversationId = extractConversationId(event);

    if (!reservationId) {
      log.info("No reservationId found, skipping");
      return;
    }

    // הזמנה שאושרה זה עתה — WOW בלבד
    if (eventType === "reservation.updated") {
      if (!wasJustConfirmed(event)) {
        log.info("reservation.updated but not a confirmation transition, skipping");
        return;
      }

      log.info("Reservation just confirmed — running WOW analysis");

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

      const listing = reservation.listingId ? await getListing(reservation.listingId) : null;
      const status = formatStatus(reservation.status, reservation.isReturningGuest);

      log.info("Context resolved", {
        guestName: reservation.guestName,
        listingTitle: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        status,
      });

      await saveConversation(reservationId, guestMessages, {
        guestName: reservation.guestName,
        listingNickname: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        source: reservation.source,
      });

      await handleWow({ reservationId, guestMessages, reservation, listing, status });
      return;
    }

    // הודעה נכנסת — WOW + Unhappy
    if (eventType === "reservation.messageReceived") {
      const conversation = event?.conversation ?? {};
      const thread: GuestyMessage[] = conversation.thread ?? [];
      const guestMessages = extractMessagesFromThread(thread);

      if (!guestMessages) {
        log.info("No guest messages found, skipping");
        return;
      }

      const messageCount = countGuestMessages(thread);
      const reservation = await getReservation(reservationId);
      if (!reservation) return;

      const listing = reservation.listingId ? await getListing(reservation.listingId) : null;
      const status = formatStatus(reservation.status, reservation.isReturningGuest);

      log.info("Context resolved", {
        guestName: reservation.guestName,
        listingTitle: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        status,
        isReturningGuest: reservation.isReturningGuest,
      });

      // שמור שיחה ב-Redis
      await saveConversation(reservationId, guestMessages, {
        guestName: reservation.guestName,
        listingNickname: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        source: reservation.source,
      });
      log.info(`Conversation saved for ${reservation.guestName} (${reservationId})`);

      // הרץ WOW ו-Unhappy במקביל — כל אחד בעולם שלו
      const tasks: Promise<void>[] = [];

      if (shouldRunWow(reservation)) {
        tasks.push(handleWow({ reservationId, guestMessages, reservation, listing, status }));
      } else {
        log.info(`WOW skipped — inquiry status from ${reservation.source}`);
      }

      tasks.push(handleUnhappy({ reservationId, guestMessages, messageCount, reservation, listing }));

      await Promise.all(tasks);
      return;
    }

    log.info("Unknown event type, skipping", { eventType });

  } catch (err) {
    log.error("Webhook handler error", { error: String(err) });
  }
}