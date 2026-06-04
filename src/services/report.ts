import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("report");
const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface GuestCaseStatus {
  guestName: string;
  listingNickname: string;
  issue: string;
  status: "open" | "resolved_uncertain" | "resolved_confirmed";
  urgency: "high" | "medium" | "low";
  openedAt?: string;
}

const SYSTEM_PROMPT = `You are a hospitality operations analyst for O&O Group, a vacation rental company in Israel and Greece.

Your job is to read a guest conversation and determine if there is a genuine problem that requires the team's attention.

CLASSIFY into one of four results:

none — No issue at all. Use this when:
- Guest is asking logistical questions (early check-in, late checkout, crib, parking, WiFi, instructions)
- Guest is requesting upgrades, discounts, or price negotiations
- Guest is sending documents (passport, ETA forms)
- Guest is communicating warmly and positively
- Guest already checked out and left a minor compliment or general feedback
- The conversation is routine pre-arrival coordination with no frustration

open — A real problem exists and has NOT been resolved. Use this when:
- Something in the property is broken, dirty, missing, or not working
- Guest explicitly complained and has not received a resolution
- Guest cannot access the property
- Guest is currently in the property and experiencing a problem
- Guest expressed clear dissatisfaction about something that has not been addressed

resolved_uncertain — The problem appears technically handled but satisfaction is unclear. Use this when:
- A fix was sent or attempted, but the guest's response is cold, clipped, or ambiguous
- Guest said "ok" or "fine" without genuine warmth after a problem
- Guest has not responded after a resolution was offered

resolved_confirmed — The problem is fully resolved and guest is satisfied. Use this when:
- Guest explicitly said thank you, expressed appreciation, or confirmed all is good after a problem

URGENCY (only relevant when status is open or resolved_uncertain):
- high: Guest is currently in the property with an active problem affecting their stay right now
- medium: Problem exists but is not an emergency, or guest not yet checked in
- low: Minor friction or subtle dissatisfaction

WHAT TO CLASSIFY AS "none" — CRITICAL EXAMPLES:
- Guest asks about early check-in → none
- Guest asks for a baby crib → none
- Guest asks about parking → none
- Guest asks for late checkout → none
- Guest asks about prices or discounts → none
- Guest asks how to reach us on WhatsApp → none
- Guest asks about WiFi password → none
- Guest sends passport for check-in → none
- Guest asks about visitor policy or guest count → none
- Guest asks about kitchen equipment before arrival → none
- Guest checks in smoothly and says "thank you, see you" → none
- Guest asks for invoice with VAT → none

OUTPUT ONLY these three lines — no extra text, no action items:
STATUS: open/resolved_uncertain/resolved_confirmed/none
URGENCY: high/medium/low
ISSUE: [one sentence describing the actual problem, or "None"]

Do NOT ask for more information. Analyze only what is provided.`;

export async function analyzeGuestCase(
  guestName: string,
  listingNickname: string,
  messages: string,
): Promise<GuestCaseStatus | null> {
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Guest: ${guestName}\nListing: ${listingNickname}\n\nConversation:\n${messages}` }],
    });

    const first = response.content[0];
    const text = first && first.type === "text" ? first.text : "";

    const statusMatch = text.match(/STATUS:\s*(open|resolved_uncertain|resolved_confirmed|none)/i);
    const urgencyMatch = text.match(/URGENCY:\s*(high|medium|low)/i);
    const issueMatch = text.match(/ISSUE:([\s\S]*?)$/i);

    const status = statusMatch?.[1]?.toLowerCase() as GuestCaseStatus["status"] | "none";
    if (!status || status === "none") return null;

    return {
      guestName,
      listingNickname,
      issue: issueMatch?.[1]?.trim() ?? "",
      status,
      urgency: (urgencyMatch?.[1]?.toLowerCase() ?? "low") as GuestCaseStatus["urgency"],
    };
  } catch (err) {
    log.error(`Failed to analyze guest case for ${guestName}`, { error: String(err) });
    return null;
  }
}