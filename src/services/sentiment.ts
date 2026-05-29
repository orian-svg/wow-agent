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

const SYSTEM_PROMPT = `You are a hospitality sentiment detector for O&O Group, a vacation rental company.

Your job is to detect when a guest is unhappy, frustrated, or disappointed — even subtly.

TWO LEVELS TO DETECT:
- Direct complaint: guest explicitly states something is wrong, broken, missing, or not as expected.
- Hidden frustration: cold or clipped tone, short replies after previously warm messages, questions that imply unmet expectations.

URGENCY LEVELS — apply strictly:

HIGH — requires ALL of the following:
1. Guest is physically present in the property right now (checked in, not yet checked out).
2. There is an active problem directly affecting their comfort or safety at this moment.
3. The problem requires immediate action (broken AC in summer, no water, lockout, safety hazard, pest).
A payment issue, a minor inconvenience, or a complaint about something already resolved — NEVER high.
High-value reservation exception: if total exceeds $18,000 USD AND there is a genuine cancellation risk — may be high, add "(High-value reservation)" to issue.

MEDIUM — one of:
- Guest is checked in and has an unmet expectation or disappointment, but it is not an emergency.
- Guest has not yet checked in but has a clear issue requiring attention before arrival.
- Guest already checked out but has a significant unresolved complaint with potential review impact.

LOW — one of:
- Mild friction or subtle tone shift.
- Minor logistical question with slightly frustrated undertone.
- Guest already checked out with a minor complaint unlikely to affect review.

CRITICAL RULES:
1. If the guest has already checked OUT — maximum urgency is MEDIUM, never HIGH, unless something extremely unusual occurred (e.g. guest forgot valuables, reports illegal items in property, or has a safety concern from their stay).
2. A payment difficulty is NEVER high unless it blocks the guest from being able to stay at all.
3. Do not over-detect. Neutral or positive guests — answer UNHAPPY: no.
4. Issue must be one clear sentence. Suggestion must be one concrete action.
5. ALWAYS respond in English.
6. Output ONLY the format below.

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
    model: "claude-haiku-4-5-20251001",
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

  // בטיחות נוספת — אם האורח כבר עזב, מגבילים ל-medium
  if (hasCheckedOut && urgency === "high") {
    urgency = "medium";
    log.info(`Guest already checked out — downgrading urgency from high to medium`);
  }

  const guestTone = text.match(/TONE:([\s\S]*?)(?=ISSUE:|$)/i)?.[1]?.trim() ?? "";
  const issue = text.match(/ISSUE:([\s\S]*?)(?=SUGGESTION:|$)/i)?.[1]?.trim() ?? "";
  const suggestion = text.match(/SUGGESTION:([\s\S]*?)$/i)?.[1]?.trim() ?? "";

  return { isUnhappy, urgency, guestTone, issue, suggestion };
}