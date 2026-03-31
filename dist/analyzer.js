"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeForWowOpportunity = analyzeForWowOpportunity;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const types_js_1 = require("./types.js");
const client = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const SYSTEM_PROMPT = `You are an elite hospitality concierge AI for a premium short-term rental company.
Your job is to read incoming guest messages and identify opportunities to create genuine "WOW moments" —
unexpected, personalized gestures that turn a good stay into an unforgettable one.

WOW moment triggers to watch for:
- Special occasions: birthdays, anniversaries, honeymoons, baby moons, graduations, proposals
- Preferences revealed: dietary needs, allergies, hobbies, favorite treats, accessibility needs
- Loyal or returning guests expressing excitement about coming back
- Complaints or frustrations you can surprise-reverse into a delight
- Hints at what they're doing nearby (wine tour, marathon, beach wedding) you can support
- Families with young children or pets who might appreciate small touches
- Guests arriving from long trips who may need extra comfort

NOT every message is a WOW opportunity. A simple "what's the WiFi password?" is not one.
Only flag genuine, actionable opportunities. Be specific — vague "be nice" advice is useless.
Suggested actions should be things front-line staff can actually do today (leave a note, arrange flowers,
stock the fridge, contact the local bakery, etc.).`;
async function analyzeForWowOpportunity(message, guest, reservation) {
    const guestName = guest
        ? `${guest.firstName} ${guest.lastName}`.trim()
        : "Unknown guest";
    const stayInfo = reservation
        ? `Check-in: ${reservation.checkIn}, Check-out: ${reservation.checkOut}, ` +
            `Property: ${reservation.listingName ?? reservation.listingId}, ` +
            `Nights: ${reservation.nightsCount ?? "?"}`
        : "No reservation details available";
    const userContent = `
Guest: ${guestName}
${stayInfo}

Guest message:
"""
${message}
"""

Analyze this message for WOW moment opportunities.
`.trim();
    // Use tool use for structured JSON output. Force the model to always call
    // "report_wow_opportunity" so we get typed, parseable output.
    // Thinking requires budget_tokens >= 1024 and budget < max_tokens.
    const WOW_TOOL = {
        name: "report_wow_opportunity",
        description: "Report the WOW moment analysis result for this guest message",
        input_schema: {
            type: "object",
            properties: {
                isOpportunity: {
                    type: "boolean",
                    description: "True if this message contains a genuine WOW moment opportunity",
                },
                opportunityType: {
                    type: "string",
                    enum: ["special_occasion", "preference", "loyalty", "service_recovery", "proactive_help"],
                    description: "The category of WOW opportunity, or null if none",
                    nullable: true,
                },
                urgency: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "high = act before check-in or within hours; medium = within the day; low = nice to do",
                },
                headline: {
                    type: "string",
                    description: "One punchy sentence summarizing the opportunity for the ops team",
                },
                suggestedActions: {
                    type: "array",
                    items: { type: "string" },
                    description: "2-4 concrete actions staff can take right now",
                },
                guestContext: {
                    type: "string",
                    description: "Brief summary of what the guest said / needs, in plain English for the team",
                },
            },
            required: ["isOpportunity", "opportunityType", "urgency", "headline", "suggestedActions", "guestContext"],
        },
    };
    const response = await client.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        tools: [WOW_TOOL],
        tool_choice: { type: "tool", name: "report_wow_opportunity" },
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
        throw new Error("Model did not call the expected tool");
    }
    return types_js_1.WowOpportunitySchema.parse(toolUse.input);
}
