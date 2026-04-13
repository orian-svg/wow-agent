import "dotenv/config";
import express, { type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function sendSlackMessage(channel: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
}

function getChannel(listing: string): string {
  const lower = listing.toLowerCase();
  if (lower.includes("athens") || lower.includes("greece")) {
    return "#wow-athens";
  }
  return "#wow-israel";
}

app.post("/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const event = req.body;
console.log("FULL EVENT:", JSON.stringify(event, null, 2));
console.log("META:", JSON.stringify(event.conversation?.meta, null, 2));
    console.log("Webhook received");
    console.log("CONV KEYS:", Object.keys(event.conversation ?? {}));
    console.log("INTEGRATION:", JSON.stringify(event.conversation?.integration));

    const conversation = event.conversation;
    if (!conversation) {
      console.log("No conversation in payload");
      return;
    }

    const thread = conversation.thread ?? [];
    const guestMessages = thread
      .filter((m: any) => m.type === "fromGuest")
      .map((m: any) => m.body)
      .join("\n");

    if (!guestMessages) {
      console.log("No guest messages found");
      return;
    }

    console.log("Guest messages:", guestMessages.substring(0, 100));

    const listingTitle = conversation.integration?.platform ?? "";
    const guestName = conversation.meta?.guestName ?? "Guest";
    const channel = getChannel(listingTitle);

    const prompt = `You are a WOW hospitality agent for O&O Group, a vacation rental company.

Your philosophy is rooted in "Unreasonable Hospitality" by Will Guidara.
A WOW moment comes ONLY from what the guest explicitly shared — never guess.
If the guest hasn't revealed anything personal, answer OPPORTUNITY: no.

Guest: ${guestName}

Guest messages:
${guestMessages}

STRICT RULES:
1. Only identify an opportunity if the guest explicitly mentioned something personal.
2. Do NOT guess based on name, nationality, or anything not stated.
3. If nothing personal was shared — answer OPPORTUNITY: no.
4. The suggestion must be specific and genuinely personal.

Answer in this exact format:
OPPORTUNITY: yes/no
WHAT: [max 2 lines]
WHY: [max 2 lines — exact quote from the conversation]`;

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    console.log("Analysis:", analysis.substring(0, 150));

    if (!analysis.includes("OPPORTUNITY: yes")) return;

    const what = analysis.match(/WHAT:(.*?)(?=WHY:|$)/s)?.[1]?.trim() ?? "";
    const why = analysis.match(/WHY:(.*?)$/s)?.[1]?.trim() ?? "";

    const message = `*WOW Opportunity* 🌟\n\n*שם אורח:* ${guestName}\n\n*מה ההזדמנות:*\n${what}\n\n*למה זו הזדמנות:*\n${why}`.trim();

    await sendSlackMessage(channel, message);
    console.log(`Sent to ${channel}`);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`WOW Agent listening on port ${PORT}`);
});