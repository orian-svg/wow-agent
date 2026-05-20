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
- Hidden frustration: cold or clipped tone, short replies after previously warm messages, questions that imply unmet expectations (e.g. "are there supposed to be towels?").

URGENCY LEVELS:
- high: active problem affecting the stay right now (broken AC, no hot water, safety issue, no response to previous message).
- medium: disappointment or unmet expectation that hasn't escalated yet.
- low: mild friction, slight tone shift, subtle dissatisfaction.

STRICT RULES:
1. Only flag if there is a clear or reasonably implied sign of unhappiness. Do not over-detect.
2. If the guest is neutral, positive, or just asking a logistical question with no negative tone — answer UNHAPPY: no.
3. Guest tone must be a brief, honest description (e.g. "frustrated and direct", "politely disappointed", "cold and clipped").
4. Issue must be one clear sentence describing what the guest is unhappy about.
5. Suggestion must be one concrete action the host can take right now.
6. ALWAYS respond in English.
7. Output ONLY the format below. No extra text.

YOUR RESPONSE FORMAT:
UNHAPPY: yes/no
URGENCY: high/medium/low
TONE: [brief description of guest tone]
ISSUE: [one sentence describing the problem]
SUGGESTION: [one concrete action for the host]`;

export async function analyzeSentiment(
  guestName: string,
  guestMessages: string,
  messageCount: number,
): Promise<SentimentAnalysis> {
  const userContent = `Guest: ${guestName}\nTotal messages in conversation: ${messageCount}\n\nGuest messages:\n${guestMessages}`;

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const first = response.content[0];
  const text = first && first.type === "text" ? first.text : "";

  log.debug("Raw sentiment analysis", { text: text.substring(0, 300) });

  const isUnhappy = /UNHAPPY:\s*yes/i.test(text);
  const urgencyMatch = text.match(/URGENCY:\s*(high|medium|low)/i);
  const urgency = (urgencyMatch?.[1]?.toLowerCase() ?? "low") as "low" | "medium" | "high";
  const guestTone = text.match(/TONE:([\s\S]*?)(?=ISSUE:|$)/i)?.[1]?.trim() ?? "";
  const issue = text.match(/ISSUE:([\s\S]*?)(?=SUGGESTION:|$)/i)?.[1]?.trim() ?? "";
  const suggestion = text.match(/SUGGESTION:([\s\S]*?)$/i)?.[1]?.trim() ?? "";

  return { isUnhappy, urgency, guestTone, issue, suggestion };
}
