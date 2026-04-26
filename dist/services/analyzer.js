"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyze = analyze;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../lib/logger.js");
const log = (0, logger_js_1.createLogger)("analyzer");
const client = new sdk_1.default({ apiKey: config_js_1.config.anthropicApiKey });
const SYSTEM_PROMPT = `You are a WOW hospitality agent for O&O Group, a vacation rental company.
Your philosophy is rooted in "Unreasonable Hospitality" by Will Guidara.

A WOW moment comes ONLY from what the guest explicitly shared — never guess.
If the guest hasn't revealed anything personal, answer OPPORTUNITY: no.

STRICT RULES:
1. Only identify an opportunity if the guest explicitly mentioned something personal.
2. Do NOT guess based on name, nationality, or anything not stated.
3. If nothing personal was shared — answer OPPORTUNITY: no.
4. The suggestion must be specific and genuinely personal.
5. The "why" must contain an exact quote from the guest's messages.

Answer in this EXACT format, and nothing else:
OPPORTUNITY: yes/no
WHAT: [max 2 lines describing the suggested gesture]
WHY: [max 2 lines — exact quote from the conversation]`;
async function analyze(guestName, guestMessages) {
    const userContent = `Guest: ${guestName}\n\nGuest messages:\n${guestMessages}`;
    const response = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
    });
    const first = response.content[0];
    const text = first && first.type === "text" ? first.text : "";
    log.debug("Raw analysis", { text: text.substring(0, 200) });
    const isOpportunity = /OPPORTUNITY:\s*yes/i.test(text);
    const what = text.match(/WHAT:([\s\S]*?)(?=WHY:|$)/i)?.[1]?.trim() ?? "";
    const why = text.match(/WHY:([\s\S]*?)$/i)?.[1]?.trim() ?? "";
    return { isOpportunity, what, why };
}
