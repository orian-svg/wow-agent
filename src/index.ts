import "dotenv/config";
import express, { type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const PORT = process.env.PORT ?? 3000;
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const listingMap: Record<string, { title: string; country: string }> = {};

async function getGuestyToken(): Promise<string> {
  const res = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "open-api",
      client_id: process.env.GUESTY_CLIENT_ID ?? "",
      client_secret: process.env.GUESTY_CLIENT_SECRET ?? "",
    }),
  });
  const data = await res.json() as any;
  return data.access_token;
}

async function loadListings() {
  try {
    const token = await getGuestyToken();
    let skip = 0;
    const limit = 50;
    let total = Infinity;

    while (skip < total) {
      const res = await fetch(`https://open-api.guesty.com/v1/listings?limit=${limit}&skip=${skip}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as any;
      if (!data.results) {
        console.log("Could not load listings:", JSON.stringify(data));
        break;
      }
      total = data.count ?? 0;
      for (const listing of data.results) {
        listingMap[listing._id] = {
          title: listing.title ?? "",
          country: listing.address?.country ?? "",
        };
      }
      skip += limit;
    }
    console.log(`Loaded ${Object.keys(listingMap).length} listings`);
  } catch (err) {
    console.error("Failed to load listings:", err);
  }
}

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

function getChannel(country: string): string {
  if (country.toLowerCase() === "greece") {
    return "#wow-athens";
  }
  return "#wow-israel";
}

app.post("/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200);
  try {
    const event = req.body;
    console.log("Webhook received");

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

    const listingId = conversation.integration?.airbnb2?.id
      ?? conversation.integration?.bookingCom?.id
      ?? "";

    const listing = listingMap[listingId];
    const listingTitle = listing?.title ?? "Unknown";
    const country = listing?.country ?? "";
    const guestName = conversation.meta?.guestName ?? "Guest";
    const channel = getChannel(country);

    console.log(`Listing: ${listingTitle} | Country: ${country} | Channel: ${channel}`);

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

    const message = `*WOW Opportunity* 🌟\n\n*שם אורח:* ${guestName}\n*דירה:* ${listingTitle}\n\n*מה ההזדמנות:*\n${what}\n\n*למה זו הזדמנות:*\n${why}`.trim();

    await sendSlackMessage(channel, message);
    console.log(`Sent to ${channel}`);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  await loadListings();
  console.log(`WOW Agent listening on port ${PORT}`);
});