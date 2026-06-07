import { createLogger } from "../lib/logger.js";
import { analyzeGuestCase } from "./report.js";
import type { GuestCaseStatus } from "./report.js";
import { getAllActiveConversations, setLastEveningReportTime, getLastEveningReportTime, autoCloseIfStale, AUTO_CLOSE_DAYS } from "../lib/memory.js";
import { config } from "../config.js";

const log = createLogger("daily-report");

const MENTION = `<@U09C5SWP4BE> <@U086JR2LF6K>`;

function urgencyEmoji(urgency: "high" | "medium" | "low"): string {
  if (urgency === "high") return "🔴";
  if (urgency === "medium") return "🟡";
  return "🟢";
}

function statusLabel(status: GuestCaseStatus["status"], daysOpen: number, isLastWarning: boolean): string {
  if (isLastWarning) return `⚠️ Final mention — will be auto-closed tomorrow if no update`;
  if (status === "open") {
    if (daysOpen === 0) return "Open — awaiting team response";
    if (daysOpen === 1) return "Open — unresolved since yesterday";
    return `Open — unresolved for ${daysOpen} days`;
  }
  if (status === "resolved_uncertain") return "Resolved — guest satisfaction unclear, follow up recommended";
  return "Resolved ✅";
}

function getDaysOpen(openedAt?: string): number {
  if (!openedAt) return 0;
  try {
    const opened = new Date(openedAt);
    const now = new Date();
    const diff = Math.floor((now.getTime() - opened.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  } catch {
    return 0;
  }
}

function formatOpenedAt(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Jerusalem",
    });
  } catch {
    return "";
  }
}

function shortTitle(issue: string, status: GuestCaseStatus["status"]): string {
  if (status === "resolved_confirmed") return "✅ Resolved";
  if (status === "resolved_uncertain") return "⚠️ Resolved — follow up needed";
  const words = issue.split(" ").slice(0, 5).join(" ");
  return words.length < issue.length ? `${words}...` : words;
}

function isLastWarningDay(openedAt: string | undefined, urgency: string): boolean {
  if (!openedAt) return false;
  const maxDays = AUTO_CLOSE_DAYS[urgency] ?? 5;
  const daysOpen = getDaysOpen(openedAt);
  return daysOpen === maxDays - 1;
}

function buildReportText(
  country: string,
  cases: Array<GuestCaseStatus & { isLastWarning?: boolean }>,
  totalStays: number,
  reportType: "evening" | "morning",
  dateStr: string,
): string {
  const header = reportType === "evening"
    ? `📋 *Daily Guest Report — ${country} | ${dateStr}*`
    : `🌅 *Overnight Report — ${country} | ${dateStr} (21:00–07:00)*`;

  if (cases.length === 0) {
    return `${header}\n\nNo issues flagged. All guests appear satisfied. ${MENTION}`;
  }

  const open = cases.filter((c) => c.status === "open");
  const uncertain = cases.filter((c) => c.status === "resolved_uncertain");
  const confirmed = cases.filter((c) => c.status === "resolved_confirmed");

  const lines: string[] = [header, ""];

  for (const c of [...open, ...uncertain, ...confirmed]) {
    const emoji = urgencyEmoji(c.urgency);
    const openedStr = c.openedAt ? ` _(opened ${formatOpenedAt(c.openedAt)})_` : "";
    const daysOpen = getDaysOpen(c.openedAt);
    const title = shortTitle(c.issue, c.status);
    const lastWarning = c.isLastWarning ?? false;

    lines.push(`${emoji} *${c.guestName}* — ${c.listingNickname}${openedStr}`);
    lines.push(`*${title}*`);
    lines.push(`Issue: ${c.issue}`);
    lines.push(`Status: ${statusLabel(c.status, daysOpen, lastWarning)}`);
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

export async function sendDailyReport(reportType: "evening" | "morning"): Promise<void> {
  log.info(`Sending ${reportType} report`);

  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  try {
    let sinceIso: string | undefined;
    if (reportType === "morning") {
      const lastEvening = await getLastEveningReportTime();
      if (lastEvening) {
        sinceIso = lastEvening;
        log.info(`Morning report filtering since last evening report: ${lastEvening}`);
      }
    }

    const conversations = await getAllActiveConversations(sinceIso);
    log.info(`Found ${conversations.length} conversations for ${reportType} report`);

    const israelCases: Array<GuestCaseStatus & { isLastWarning?: boolean }> = [];
    const athensCases: Array<GuestCaseStatus & { isLastWarning?: boolean }> = [];

    const now = new Date();
    let israelTotal = 0;
    let athensTotal = 0;

    for (const conv of conversations) {
      if (conv.manuallyResolved) {
        log.info(`Skipping ${conv.guestName} — manually resolved`);
        continue;
      }

      // בדיקת סגירה אוטומטית
      const autoCloseStatus = await autoCloseIfStale(conv.reservationId);
      if (autoCloseStatus === "closed") {
        log.info(`Auto-closed stale case for ${conv.guestName}`);
        continue;
      }

      const checkOutDate = conv.checkOut ? new Date(conv.checkOut) : null;
      const isActiveStay = !checkOutDate || checkOutDate >= new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const isGreece = conv.country.toLowerCase() === "greece" || conv.country.toLowerCase() === "gr";

      if (isActiveStay) {
        if (isGreece) athensTotal++; else israelTotal++;
      }

      const caseResult = await analyzeGuestCase(conv.guestName, conv.listingNickname, conv.messages);
      log.info(`Analysis for ${conv.guestName}: ${caseResult ? caseResult.status : "none"}`);
      if (!caseResult) continue;

      if (
        caseResult.status === "resolved_confirmed" &&
        reportType === "morning" &&
        !conv.conversationLastUpdated
      ) {
        log.info(`Skipping ${conv.guestName} — resolved_confirmed with no new messages`);
        continue;
      }

      if (conv.lastUnhappyOpenedAt) {
        caseResult.openedAt = conv.lastUnhappyOpenedAt;
      }

      const isLastWarning = autoCloseStatus === "warning" &&
        conv.lastUnhappyUrgency !== undefined &&
        conv.lastUnhappyUrgency !== "resolved";

      const enrichedCase = { ...caseResult, isLastWarning };

      if (isGreece) {
        athensCases.push(enrichedCase);
      } else {
        israelCases.push(enrichedCase);
      }
    }

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

    if (reportType === "evening") {
      await setLastEveningReportTime();
    }

  } catch (err) {
    log.error("Failed to send daily report", { error: String(err) });
  }
}