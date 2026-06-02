"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeGuestCase = analyzeGuestCase;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../lib/logger.js");
const log = (0, logger_js_1.createLogger)("report");
const client = new sdk_1.default({ apiKey: config_js_1.config.anthropicApiKey });
const SYSTEM_PROMPT = `You are a hospitality operations analyst for O&O Group, a vacation rental company.

Your job is to analyze a guest conversation and determine the current status of any issue or dissatisfaction.

CLASSIFY into one of three statuses:
- open: Issue exists and has NOT been resolved. Guest is still waiting or has not received help.
- resolved_uncertain: Issue appears resolved technically, but guest tone is still cold, clipped, or uncertain. There is no clear signal that the guest is satisfied. This is a risk for a bad review.
- resolved_confirmed: Issue was resolved AND guest clearly expressed satisfaction or confirmed all is good.
- none: No issue at all. Guest is happy or neutral with no complaints.

URGENCY:
- high: Guest is currently in the property and issue is active right now.
- medium: Issue exists but not immediately critical, or guest not yet checked in.
- low: Minor friction, already partially addressed.

OUTPUT ONLY this exact format — no additional fields, no explanations, no action items:
STATUS: open/resolved_uncertain/resolved_confirmed/none
URGENCY: high/medium/low
ISSUE: [one sentence describing the problem, or "None"]

Do NOT include any ACTION, RECOMMENDATION, or any other field. Three lines only.
Do NOT ask for more information. Analyze only what is provided. If information is insufficient, classify as "none".`;
async function analyzeGuestCase(guestName, listingNickname, messages) {
    try {
        const response = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: `Guest: ${guestName}\nListing: ${listingNickname}\n\nConversation:\n${messages}` }],
        });
        const first = response.content[0];
        const text = first && first.type === "text" ? first.text : "";
        const statusMatch = text.match(/STATUS:\s*(open|resolved_uncertain|resolved_confirmed|none)/i);
        const urgencyMatch = text.match(/URGENCY:\s*(high|medium|low)/i);
        const issueMatch = text.match(/ISSUE:([\s\S]*?)$/i);
        const status = statusMatch?.[1]?.toLowerCase();
        if (!status || status === "none")
            return null;
        return {
            guestName,
            listingNickname,
            issue: issueMatch?.[1]?.trim() ?? "",
            status,
            urgency: (urgencyMatch?.[1]?.toLowerCase() ?? "low"),
        };
    }
    catch (err) {
        log.error(`Failed to analyze guest case for ${guestName}`, { error: String(err) });
        return null;
    }
}
