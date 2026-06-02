import { createLogger } from "../lib/logger.js";
import { analyzeGuestCase } from "./report.js";
import type { GuestCaseStatus } from "./report.js";
import { getAllActiveConversations, setLastEveningReportTime, getLastEveningReportTime } from "../lib/memory.js";
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
  if (status === "resolved_uncertain") return "Resolved — satisfaction unclear";
  return "Resolved ✅";
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

function buildReportText(
  country: string,
  cases: GuestCaseStatus[],
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
    lines.push(`${emoji} *${c.guestName}* — ${c.listingNickname}${openedStr}`);
    lines.push(`Issue: ${c.issue}`);
    lines.push(`Status: ${statusLabel(c.status)}`);
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
    // דוח בוקר — רק שיחות שהתעדכנו מאז הדוח הערבי
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

    const israelCases: GuestCaseStatus[] = [];
    const athensCases: GuestCaseStatus[] = [];

    let israelTotal = 0;
    let athensTotal = 0;

    for (const conv of conversations) {
      // דלג על שיחות שסומנו כנפתרות ידנית
      if (conv.manuallyResolved) {
        log.info(`Skipping ${conv.guestName} — manually resolved`);
        continue;
      }

      const isGreece = conv.country.toLowerCase() === "greece" || conv.country.toLowerCase() === "gr";
      if (isGreece) athensTotal++; else israelTotal++;

      const caseResult = await analyzeGuestCase(conv.guestName, conv.listingNickname, conv.messages);
      log.info(`Analysis for ${conv.guestName}: ${caseResult ? caseResult.status : "none"}`);
      if (!caseResult) continue;

      // דלג על מקרים שנסגרו לגמרי בדוח הערבי ולא היו הודעות חדשות
      if (
        caseResult.status === "resolved_confirmed" &&
        reportType === "morning" &&
        !conv.conversationLastUpdated
      ) {
        log.info(`Skipping ${conv.guestName} — resolved_confirmed with no new messages`);
        continue;
      }

      // הוסף תאריך פתיחה
      if (conv.lastUnhappyOpenedAt) {
        caseResult.openedAt = conv.lastUnhappyOpenedAt;
      }

      if (isGreece) {
        athensCases.push(caseResult);
      } else {
        israelCases.push(caseResult);
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

    // שמור את שעת הדוח הערבי
    if (reportType === "evening") {
      await setLastEveningReportTime();
    }

  } catch (err) {
    log.error("Failed to send daily report", { error: String(err) });
  }
}