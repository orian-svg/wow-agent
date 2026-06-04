import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("sentiment");
const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface SentimentAnalysis {
  isUnhappy: boolean;
  urgency: "low" | "medium" | "high";
  guestTone: string;
  issue: string;
  suggestion: string;
}

const SYSTEM_PROMPT = `You are a hospitality sentiment detector for O&O Group, a vacation rental company operating in Israel and Greece.

Your ONLY job is to detect genuine unhappiness, frustration, or disappointment — not to flag routine guest communication.

WHAT IS NOT UNHAPPINESS — answer UNHAPPY: no
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LOGISTICAL REQUESTS (neutral tone, just asking):
- Asking about early check-in or late checkout
- Requesting a crib, baby seat, extra bed, towels, or any equipment
- Asking about parking availability or location
- Requesting an upgrade or a discount
- Asking about check-in instructions, access codes, or how to enter
- Asking about pricing, VAT, invoices, or payment links
- Asking about amenities (pool, gym, WiFi password)
- Asking whether something is available at the property

PRE-ARRIVAL QUESTIONS (guest not yet checked in, no frustration):
- Questions about what to bring, what is included
- Asking for WhatsApp contact for documents (passport, ETA)
- Asking about guest count changes or visitor policies
- Price negotiation or budget mismatch before booking is confirmed

POSITIVE OR NEUTRAL COMMUNICATION:
- Guest saying thank you, confirming details, acknowledging receipt
- Guest checking in successfully with no complaint
- Guest asking questions in a warm or casual tone

WHAT IS UNHAPPINESS — answer UNHAPPY: yes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIRECT COMPLAINTS:
- Something in the property is broken, not working, dirty, or missing
- Guest explicitly says they are disappointed, unhappy, or dissatisfied
- Guest threatens to cancel, leave a bad review, or escalate
- Guest reports a safety issue (gas leak, no hot water, pest, no electricity)
- Guest reports they cannot access the property and are locked out

HIDDEN FRUSTRATION:
- Guest was previously warm but tone became cold, clipped, or short
- Repeated follow-up messages about the same unresolved issue
- Questions implying something was promised but not delivered
- Guest expressing that their experience does not match what was advertised

URGENCY — apply strictly
━━━━━━━━━━━━━━━━━━━━━━━━

HIGH — ALL three must be true:
1. Guest is physically present in the property right now (checked in, not yet checked out)
2. There is an active problem affecting their comfort or safety at this moment
3. Problem requires immediate action: broken AC in summer heat, no water, lockout, electricity failure, pest infestation, safety hazard

HIGH — Special exception:
- Reservation total exceeds $18,000 USD AND guest is threatening cancellation or showing genuine cancellation risk. Add "(High-value reservation at risk)" to issue field.

NEVER HIGH:
- Guest not yet checked in (unless high-value exception applies)
- Payment issue unless guest literally cannot access the property
- Minor inconvenience or something already resolved
- Guest already checked out (maximum MEDIUM after checkout)

MEDIUM:
- Guest checked in with real disappointment, not an emergency
- Guest not yet checked in with clear problem before arrival
- Guest checked out with significant complaint that could affect review

LOW:
- Mild friction or subtle tone shift
- Minor post-stay feedback

REAL EXAMPLES
━━━━━━━━━━━━━

NOT unhappy — "Hi, can we do early check-in at 11am?"
NOT unhappy — "Could you send me the parking instructions?"
NOT unhappy — "Can you reduce the price? Our budget is $600."
NOT unhappy — "I need to send my passport. Can I use WhatsApp?"
NOT unhappy — "What is the WiFi password?"
NOT unhappy — "We are 4 people, can we get an extra bed?"
NOT unhappy — "Can we get a late checkout tomorrow?"

UNHAPPY HIGH — Guest checked in: "The AC is not working and it's very hot. We can't sleep."
UNHAPPY HIGH — Guest checked in: "There are cockroaches in the bedroom."
UNHAPPY HIGH — Guest checked in: "The lockbox is empty. We can't get in."
UNHAPPY HIGH — Guest checked in: "There is no electricity in the apartment."
UNHAPPY HIGH — Guest checked in: "The toilet is completely blocked."

UNHAPPY MEDIUM — Guest not yet checked in: "I paid more than we agreed. I'm very unhappy about this."
UNHAPPY MEDIUM — Guest checked in: "The shower head broke. Not great but we're managing."
UNHAPPY MEDIUM — Guest checked in: "The apartment is not clean. There is dirt everywhere."

UNHAPPY LOW — Guest checked out: "The towels were a bit thin. Just feedback."
UNHAPPY LOW — Guest: tone suddenly became cold after a warm exchange, no explicit complaint.

YOUR RESPONSE FORMAT:
UNHAPPY: yes/no
URGENCY: high/medium/low
TONE: [brief description]
ISSUE: [one sentence]
SUGGESTION: [one concrete action]`;

export async function analyzeSentiment(
  guestName: string,
  guestMessages: string,
  messageCount: number,
  checkIn?: string,
  checkOut?: string,
  totalPrice?: number,
): Promise<SentimentAnalysis> {
  const now = new Date();
  const checkInDate = checkIn ? new Date(checkIn) : null;
  const checkOutDate = checkOut ? new Date(checkOut) : null;
  const isCheckedIn = checkInDate ? checkInDate <= now : false;
  const hasCheckedOut = checkOutDate ? checkOutDate < now : false;
  const isHighValue = (totalPrice ?? 0) >= 18000;

  let context = `Guest: ${guestName}\nTotal messages in conversation: ${messageCount}\n`;

  if (hasCheckedOut) {
    context += `Guest status: Already checked out\n`;
  } else if (isCheckedIn) {
    context += `Guest status: Currently checked in\n`;
  } else {
    context += `Guest status: Not yet checked in\n`;
  }

  if (isHighValue) context += `Reservation value: High-value (exceeds $18,000)\n`;
  context += `\nGuest messages:\n${guestMessages}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: context }],
  });

  const first = response.content[0];
  const text = first && first.type === "text" ? first.text : "";

  log.debug("Raw sentiment analysis", { text: text.substring(0, 300) });

  const isUnhappy = /UNHAPPY:\s*yes/i.test(text);
  const urgencyMatch = text.match(/URGENCY:\s*(high|medium|low)/i);
  let urgency = (urgencyMatch?.[1]?.toLowerCase() ?? "low") as "low" | "medium" | "high";

  if (hasCheckedOut && urgency === "high") {
    urgency = "medium";
    log.info(`Guest already checked out — downgrading urgency from high to medium`);
  }

  const guestTone = text.match(/TONE:([\s\S]*?)(?=ISSUE:|$)/i)?.[1]?.trim() ?? "";
  const issue = text.match(/ISSUE:([\s\S]*?)(?=SUGGESTION:|$)/i)?.[1]?.trim() ?? "";
  const suggestion = text.match(/SUGGESTION:([\s\S]*?)$/i)?.[1]?.trim() ?? "";

  return { isUnhappy, urgency, guestTone, issue, suggestion };
}