import Anthropic from "@anthropic-ai/sdk";
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
import { config } from "../config.js";
import type { Urgency } from "../lib/memory.js";

const log = createLogger("unhappy-agent");
const client = new Anthropic({ apiKey: config.anthropicApiKey });

async function isSameIssue(previousIssue: string, newIssue: string): Promise<boolean> {
  if (!previousIssue || !newIssue) return false;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 50,
    system: `You are comparing two guest complaint descriptions to determine if they are about the same underlying problem.
Answer only YES or NO.
YES = same root problem, even if described differently or with new details.
NO = clearly different problem.`,
    messages: [{
      role: "user",
      content: `Previous issue: ${previousIssue}\nNew issue: ${newIssue}\nSame problem?`
    }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return /^\s*yes/i.test(text);
}

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

    if (lastIssue && lastUrgency === "high") {
      const same = await isSameIssue(lastIssue, sentiment.issue);
      if (same) {
        log.info(`Same High issue already reported — skipping duplicate alert`);
        return;
      }
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