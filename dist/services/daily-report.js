"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDailyReport = sendDailyReport;
const logger_js_1 = require("../lib/logger.js");
const report_js_1 = require("./report.js");
const memory_js_1 = require("../lib/memory.js");
const config_js_1 = require("../config.js");
const log = (0, logger_js_1.createLogger)("daily-report");
const MENTION = `<@U09C5SWP4BE> <@U086JR2LF6K>`;
function urgencyEmoji(urgency) {
    if (urgency === "high")
        return "🔴";
    if (urgency === "medium")
        return "🟡";
    return "🟢";
}
function statusLabel(status) {
    if (status === "open")
        return "Open — needs attention";
    if (status === "resolved_uncertain")
        return "Resolved — guest satisfaction unclear";
    return "Resolved ✅";
}
function buildReportText(country, cases, totalStays, reportType, dateStr) {
    const header = reportType === "evening"
        ? `📋 *Daily Guest Report — ${country} | ${dateStr}*`
        : `🌅 *Overnight Report — ${country} | ${dateStr} (23:00–07:00)*`;
    if (cases.length === 0) {
        return `${header}\n\nNo issues flagged. All guests appear satisfied. ${MENTION}`;
    }
    const open = cases.filter((c) => c.status === "open");
    const uncertain = cases.filter((c) => c.status === "resolved_uncertain");
    const confirmed = cases.filter((c) => c.status === "resolved_confirmed");
    const lines = [header, ""];
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
async function postToSlack(channel, text) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config_js_1.config.slackBotToken}`,
        },
        body: JSON.stringify({ channel, text }),
    });
    const data = (await response.json());
    if (!data.ok)
        throw new Error(`Slack error: ${data.error}`);
}
async function sendDailyReport(reportType) {
    log.info(`Sending ${reportType} report`);
    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    try {
        const conversations = (0, memory_js_1.getAllActiveConversations)();
        log.info(`Found ${conversations.length} active conversations in memory`);
        const israelCases = [];
        const athensCases = [];
        let israelTotal = 0;
        let athensTotal = 0;
        for (const conv of conversations) {
            const isGreece = conv.country.toLowerCase() === "greece" || conv.country.toLowerCase() === "gr";
            if (isGreece)
                athensTotal++;
            else
                israelTotal++;
            const caseResult = await (0, report_js_1.analyzeGuestCase)(conv.guestName, conv.listingNickname, conv.messages);
            log.info(`Analysis for ${conv.guestName}: ${caseResult ? caseResult.status : "none"}`);
            if (!caseResult)
                continue;
            if (isGreece) {
                athensCases.push(caseResult);
            }
            else {
                israelCases.push(caseResult);
            }
        }
        if (israelCases.length > 0 || reportType === "evening") {
            const israelText = buildReportText("Israel", israelCases, israelTotal, reportType, dateStr);
            await postToSlack(config_js_1.config.slackChannelUnhappyIsrael, israelText);
            log.info(`Israel report sent (${israelCases.length} cases)`);
        }
        if (athensCases.length > 0 || reportType === "evening") {
            const athensText = buildReportText("Athens", athensCases, athensTotal, reportType, dateStr);
            await postToSlack(config_js_1.config.slackChannelUnhappyAthens, athensText);
            log.info(`Athens report sent (${athensCases.length} cases)`);
        }
    }
    catch (err) {
        log.error("Failed to send daily report", { error: String(err) });
    }
}
