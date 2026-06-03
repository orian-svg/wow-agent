import { createLogger } from "../lib/logger.js";
import { sendUnhappyAlert, sendUnhappyResolved } from "./slack.js";
import { analyzeSentiment } from "./sentiment.js";
import {
  getLastUnhappyUrgency,
  getLastUnhappyIssue,
  getUnhappyThreadTs,
  recordUnhappyAlert,
  URGENCY_RANK,
} from "../lib/memory.js";
import type { Urgency } from "../lib/memory.js";

const log = createLogger("unhappy-agent");

export async function handleUnhappy({
  reservationId,
  guestMessages,
  messageCount,
  reservation,
  listing,
}: {
  reservationId: string;
  guestMessages: string;
  messageCount: number;
  reservation: { guestName: string; checkIn: string; checkOut: string; source: string; totalPrice: number };
  listing: { country: string; title: string } | null;
}): Promise<void> {
  const sentiment = await analyzeSentiment(
    reservation.guestName,
    guestMessages,
    messageCount,
    reservation.checkIn,
    reservation.checkOut,
    reservation.totalPrice
  );

  log.info("Sentiment analysis result", { isUnhappy: sentiment.isUnhappy, urgency: sentiment.urgency });

  const lastUrgency = await getLastUnhappyUrgency(reservationId);
  const threadTs = await getUnhappyThreadTs(reservationId);
  const newUrgency: Urgency = sentiment.isUnhappy ? sentiment.urgency : "resolved";
  const newRank = URGENCY_RANK[newUrgency];
  const lastRank = lastUrgency !== undefined ? URGENCY_RANK[lastUrgency] : undefined;

  if (!sentiment.isUnhappy && lastUrgency === undefined) return;

  if (sentiment.isUnhappy && sentiment.urgency === "high") {
    const lastIssue = await getLastUnhappyIssue(reservationId);
    const isSameIssue = lastIssue && sentiment.issue &&
      lastIssue.toLowerCase().substring(0, 60) === sentiment.issue.toLowerCase().substring(0, 60);

    if (isSameIssue) {
      log.info(`Same High issue already reported — skipping duplicate alert`);
      return;
    }

    const isAdditionalIssue = lastUrgency === "high";
    const ts = await sendUnhappyAlert({
      country: listing?.country ?? "",
      guestName: reservation.guestName,
      listingTitle: listing?.title ?? "Unknown",
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      source: reservation.source,
      messageCount,
      sentiment,
      threadTs: undefined,
      isAdditionalIssue,
    });
    await recordUnhappyAlert(reservationId, newUrgency, ts, sentiment.issue);
    return;
  }

  if (sentiment.isUnhappy && (lastRank === undefined || newRank > lastRank)) {
    await recordUnhappyAlert(reservationId, newUrgency, undefined, sentiment.issue);
    log.info(`Urgency ${sentiment.urgency} — saved for daily report, no real-time alert`);
    return;
  }

  if (lastUrgency !== undefined && newRank < lastRank! && threadTs) {
    await sendUnhappyResolved({
      country: listing?.country ?? "",
      guestName: reservation.guestName,
      isFullyResolved: !sentiment.isUnhappy,
      newUrgency: sentiment.isUnhappy ? sentiment.urgency : undefined,
      threadTs,
    });
    await recordUnhappyAlert(reservationId, newUrgency);
  }
}
