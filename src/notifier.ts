import type { AlertContext } from "./types.js";

const URGENCY_EMOJI: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

const TYPE_EMOJI: Record<string, string> = {
  special_occasion: "🎉",
  preference: "⭐",
  loyalty: "💎",
  service_recovery: "🛠️",
  proactive_help: "🤝",
};

/**
 * Send a WOW moment alert to Slack via incoming webhook.
 * Set SLACK_WEBHOOK_URL in your environment to enable.
 */
export async function sendSlackAlert(ctx: AlertContext): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[notifier] SLACK_WEBHOOK_URL not set — logging alert to console only");
    logToConsole(ctx);
    return;
  }

  const { opportunity, guest, reservation } = ctx;
  const urgencyEmoji = URGENCY_EMOJI[opportunity.urgency] ?? "⚪";
  const typeEmoji = opportunity.opportunityType
    ? TYPE_EMOJI[opportunity.opportunityType] ?? "✨"
    : "✨";

  const guestName = guest
    ? `${guest.firstName} ${guest.lastName}`.trim()
    : "Unknown guest";

  const checkIn = reservation?.checkIn
    ? new Date(reservation.checkIn).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      })
    : "unknown";

  const property = reservation?.listingName ?? reservation?.listingId ?? "unknown property";

  const actionsText = opportunity.suggestedActions
    .map((a, i) => `${i + 1}. ${a}`)
    .join("\n");

  const payload = {
    text: `${urgencyEmoji} *WOW Opportunity* — ${opportunity.headline}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${urgencyEmoji} ${typeEmoji} WOW Opportunity Detected`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${opportunity.headline}*`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Guest:*\n${guestName}` },
          { type: "mrkdwn", text: `*Check-in:*\n${checkIn}` },
          { type: "mrkdwn", text: `*Property:*\n${property}` },
          { type: "mrkdwn", text: `*Urgency:*\n${opportunity.urgency.toUpperCase()}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*What the guest said:*\n_${ctx.originalMessage}_`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Context:*\n${opportunity.guestContext}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Suggested actions:*\n${actionsText}`,
        },
      },
      { type: "divider" },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }

  console.log(`[notifier] Slack alert sent for guest ${guestName}`);
}

function logToConsole(ctx: AlertContext): void {
  const { opportunity, guest } = ctx;
  const guestName = guest ? `${guest.firstName} ${guest.lastName}` : "Unknown";
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🎯 WOW OPPORTUNITY [${opportunity.urgency.toUpperCase()}]`);
  console.log(`Guest: ${guestName}`);
  console.log(`Headline: ${opportunity.headline}`);
  console.log(`Context: ${opportunity.guestContext}`);
  console.log("Actions:");
  opportunity.suggestedActions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}
