import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { getListing, getReservation, getConversation } from "../services/guesty.js";
import { buildAlertParams, sendAlert, sendUnhappyAlert, sendUnhappyResolved } from "../services/slack.js";
import { analyze } from "../services/analyzer.js";
import { analyzeSentiment } from "../services/sentiment.js";
import {
  getPastOpportunities,
  recordOpportunity,
  getLastUnhappyUrgency,
  getUnhappyThreadTs,
  recordUnhappyAlert,
  URGENCY_RANK,
} from "../lib/memory.js";
import type { Urgency } from "../lib/memory.js";
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

async function handleAnalysis({
  reservationId,
  guestMessages,
  messageCount,
  reservation,
  listing,
  status,
  runSentiment,
}: {
  reservationId: string;
  guestMessages: string;
  messageCount: number;
  reservation: { guestName: string; checkIn: string; checkOut: string; source: string; status: string };
  listing: { country: string; title: string } | null;
  status: string;
  runSentiment: boolean;
}): Promise<void> {
  const pastOpportunities = getPastOpportunities(reservationId);
  const promises: Promise<void>[] = [];

  promises.push(
    analyze(reservation.guestName, guestMessages, pastOpportunities).then(async (analysis) => {
      log.info("WOW analysis result", { isOpportunity: analysis.isOpportunity });
      if (!analysis.isOpportunity) return;

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
      recordOpportunity(reservationId, analysis.why);
    })
  );

  if (runSentiment) {
    promises.push(
      analyzeSentiment(reservation.guestName, guestMessages, messageCount).then(async (sentiment) => {
        log.info("Sentiment analysis result", { isUnhappy: sentiment.isUnhappy, urgency: sentiment.urgency });

        const lastUrgency = getLastUnhappyUrgency(reservationId);
        const threadTs = getUnhappyThreadTs(reservationId);
        const newUrgency: Urgency = sentiment.isUnhappy ? sentiment.urgency : "resolved";
        const newRank = URGENCY_RANK[newUrgency];
        const lastRank = lastUrgency !== undefined ? URGENCY_RANK[lastUrgency] : undefined;

        // אם אין היסטוריה ואורח מרוצה — לא עושים כלום
        if (!sentiment.isUnhappy && lastUrgency === undefined) return;

        // אם הדחיפות עלתה — שולחים התראה
        if (sentiment.isUnhappy && (lastRank === undefined || newRank > lastRank)) {
          const ts = await sendUnhappyAlert({
            country: listing?.country ?? "",
            guestName: reservation.guestName,
            listingTitle: listing?.title ?? "Unknown",
            checkIn: reservation.checkIn,
            checkOut: reservation.checkOut,
            source: reservation.source,
            messageCount,
            sentiment,
            threadTs,
          });
          recordUnhappyAlert(reservationId, newUrgency, threadTs ? undefined : ts);
          return;
        }

        // אם הדחיפות ירדה או הבעיה נפתרה — שולחים עדכון ירוק בשרשור
        if (lastUrgency !== undefined && newRank < lastRank! && threadTs) {
          await sendUnhappyResolved({
            country: listing?.country ?? "",
            guestName: reservation.guestName,
            isFullyResolved: !sentiment.isUnhappy,
            newUrgency: sentiment.isUnhappy ? sentiment.urgency : undefined,
            threadTs,
          });
          recordUnhappyAlert(reservationId, newUrgency);
        }
      })
    );
  }

  await Promise.all(promises);
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

      const messageCount = countGuestMessages(thread);
      const listing = reservation.listingId ? await getListing(reservation.listingId) : null;
      const status = formatStatus(reservation.status, reservation.isReturningGuest);

      log.info("Context resolved", {
        guestName: reservation.guestName,
        listingTitle: listing?.title ?? "Unknown",
        country: listing?.country ?? "",
        status,
      });

      await handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment: false });
      return;
    }

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

      await handleAnalysis({ reservationId, guestMessages, messageCount, reservation, listing, status, runSentiment: true });
      return;
    }

    log.info("Unknown event type, skipping", { eventType });

  } catch (err) {
    log.error("Webhook handler error", { error: String(err) });
  }
}