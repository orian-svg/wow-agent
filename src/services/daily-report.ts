import { createLogger } from "../lib/logger.js";
import { getListing, getReservation } from "./guesty.js";
import { analyzeGuestCase } from "./report.js";
import type { GuestCaseStatus } from "./report.js";
import { config } from "../config.js";

const log = createLogger("daily-report");

const MENTION = `<@U09C5SWP4BE> <@U086JR2LF6K>`;

function urgencyEmoji(urgency: "high" | "medium" | "low"): string {
  if (urgency === "high") return "🔴";
  if (urgency === "medium") return "🟡";
  return "🟢";
}

function statusLabel(status: GuestCaseStatus["status"]): string {
  if (status === "open") return "Open — needs attention";
  if (status === "resolved_uncertain") return "Resolved — guest satisfaction unclear";
  return "Resolved ✅";
}

function buildReportText(
  country: string,
  cases: GuestCaseStatus[],
  totalStays: number,
  reportType: "evening" | "morning",
  dateStr: string,
): string {
  const header = reportType === "evening"
    ? `📋 *Daily Guest Report — ${country} | ${dateStr}*`
    : `🌅 *Overnight Report — ${country} | ${dateStr} (23:00–07:00)*`;

  if (cases.length === 0) {
    return `${header}\n\nNo issues flagged. All guests appear satisfied. ${MENTION}`;
  }

  const open = cases.filter((c) => c.status === "open");
  const uncertain = cases.filter((c) => c.status === "resolved_uncertain");
  const confirmed = cases.filter((c) => c.status === "resolved_confirmed");

  const lines: string[] = [header, ""];

  for (const c of [...open, ...uncertain, ...confirmed]) {
    const emoji = urgencyEmoji(c.urgency);
    lines.push(`${emoji} *${c.guestName}* — ${c.listingNickname}`);
    lines.push(`Issue: ${c.issue}`);
    lines.push(`Status: ${statusLabel(c.status)}`);
    if (c.actionNeeded && c.actionNeeded !== "None needed") {
      lines.push(`Action needed: ${c.actionNeeded}`);
    }
    lines.push("");
  }

  lines.push(`Total active stays: ${totalStays} | Issues flagged: ${cases.length} | Open: ${open.length} | Needs follow-up: ${uncertain.length} | Resolved: ${confirmed.length}`);
  lines.push("");
  lines.push(MENTION);

  return lines.join("\n");
}

async function postToSlack(channel: string, text: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.slackBotToken}`,
    },
    body: JSON.stringify({ channel, text }),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
}

async function fetchActiveReservations(): Promise<Array<{
  reservationId: string;
  guestName: string;
  listingNickname: string;
  country: string;
  messages: string;
}>> {
  // שולף הזמנות פעילות מגסטי לפי תאריך
  const token = await getGuestyToken();
  const today = new Date().toISOString().split("T")[0];

  const response = await fetch(
    `https://open-api.guesty.com/v1/reservations?status=confirmed&checkIn[$lte]=${today}&checkOut[$gte]=${today}&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    log.error("Failed to fetch active reservations");
    return [];
  }

  const data = (await response.json()) as {
    results?: Array<{
      _id: string;
      listingId?: string;
      guest?: { fullName?: string; firstName?: string; lastName?: string };
    }>;
  };

  const results = [];

  for (const res of data.results ?? []) {
    try {
      const listing = res.listingId ? await getListing(res.listingId) : null;
      const country = listing?.country ?? "";
      const nickname = listing?.title ?? "Unknown";

      const firstName = res.guest?.firstName ?? "";
      const lastName = res.guest?.lastName ?? "";
      const combinedName = `${firstName} ${lastName}`.trim();
      const fullName = (res.guest?.fullName || combinedName) || "Guest";

      // שלוף שיחות
      const convResponse = await fetch(
        `https://open-api.guesty.com/v1/communication/conversations?reservationId=${res._id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!convResponse.ok) continue;

      const convData = (await convResponse.json()) as {
        results?: Array<{ thread?: Array<{ type: string; body?: string }> }>;
      };

      const messages = (convData.results ?? [])
        .flatMap((c) => c.thread ?? [])
        .filter((m) => m.type === "fromGuest" || m.type === "fromHost")
        .map((m) => m.body ?? "")
        .filter((b) => b.trim().length > 0)
        .join("\n");

      if (!messages) continue;

      results.push({ reservationId: res._id, guestName: fullName, listingNickname: nickname, country, messages });
    } catch (err) {
      log.error(`Failed to process reservation ${res._id}`, { error: String(err) });
    }
  }

  return results;
}

async function getGuestyToken(): Promise<string> {
  const response = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "open-api",
      client_id: config.guestyClientId,
      client_secret: config.guestyClientSecret,
    }),
  });
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Failed to get Guesty token");
  return data.access_token;
}

export async function sendDailyReport(reportType: "evening" | "morning"): Promise<void> {
  log.info(`Sending ${reportType} report`);

  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  try {
    const reservations = await fetchActiveReservations();
    const totalStays = reservations.length;

    const israelCases: GuestCaseStatus[] = [];
    const athensCases: GuestCaseStatus[] = [];

    for (const res of reservations) {
      const caseResult = await analyzeGuestCase(res.guestName, res.listingNickname, res.messages);
      if (!caseResult) continue;

      const isGreece = res.country.toLowerCase() === "greece" || res.country.toLowerCase() === "gr";
      if (isGreece) {
        athensCases.push(caseResult);
      } else {
        israelCases.push(caseResult);
      }
    }

    const israelTotal = reservations.filter((r) => r.country.toLowerCase() !== "greece" && r.country.toLowerCase() !== "gr").length;
    const athensTotal = reservations.filter((r) => r.country.toLowerCase() === "greece" || r.country.toLowerCase() === "gr").length;

    if (israelCases.length > 0 || reportType === "evening") {
      const israelText = buildReportText("Israel", israelCases, israelTotal, reportType, dateStr);
      await postToSlack(config.slackChannelUnhappyIsrael, israelText);
      log.info(`Israel report sent (${israelCases.length} cases)`);
    }

    if (athensCases.length > 0 || reportType === "evening") {
      const athensText = buildReportText("Athens", athensCases, athensTotal, reportType, dateStr);
      await postToSlack(config.slackChannelUnhappyAthens, athensText);
      log.info(`Athens report sent (${athensCases.length} cases)`);
    }

  } catch (err) {
    log.error("Failed to send daily report", { error: String(err) });
  }
}