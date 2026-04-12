import "dotenv/config";
import express, { type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

let guestyToken = "";
let tokenExpiry = 0;

async function getGuestyToken(): Promise<string> {
  if (guestyToken && Date.now() < tokenExpiry) return guestyToken;

  console.log("Getting new Guesty token...");
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("scope", "open-api");
  params.append("client_secret", process.env.GUESTY_CLIENT_SECRET ?? "");
  params.append("client_id", process.env.GUESTY_CLIENT_ID ?? "");

  const res = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const data = await res.json() as any;
  if (!data.access_token) {
    console.error("Failed to get token:", JSON.stringify(data));
    return "";
  }
  console.log("Got Guesty token successfully");
  guestyToken = data.access_token ?? "";
  tokenExpiry = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return guestyToken;
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

async function getRecentReservations() {
  const token = await getGuestyToken();
  if (!token) return [];

  const res = await fetch(
    "https://open-api.guesty.com/v1/reservations?limit=20&sort=-createdAt",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await res.json() as any;
  if (!res.ok) {
    console.error("Guesty reservations error:", JSON.stringify(data));
    return [];
  }
  console.log(`Found ${data.results?.length ?? 0} reservations`);
  return data.results ?? [];
}

async function getReservationMessages(reservationId: string) {
  const token = await getGuestyToken();
  if (!token) return [];

  const resRes = await fetch(
    `https://open-api.guesty.com/v1/reservations/${reservationId}?fields=conversationId`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const resData = await resRes.json() as any;
  const conversationId = resData.conversationId;
  if (!conversationId) return [];

  const msgRes = await fetch(
    `https://open-api.guesty.com/v1/communication/conversations/${conversationId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const msgData = await msgRes.json() as any;
  return msgData.messages ?? [];
}

function getStayStatus(checkIn: string, checkOut: string): string {
  const now = new Date();
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  if (now < checkInDate) return "עתידי";
  if (now > checkOutDate) return "סיים";
  return "נוכחי";
}

function getChannel(listing: string): string {
  const lower = listing.toLowerCase();
  if (
    lower.includes("athens") ||
    lower.includes("greece") ||
    lower.includes("אתונה") ||
    lower.includes("יוון")
  ) {
    return "#wow-athens";
  }
  return "#wow-israel";
}

async function analyzeConversation(reservation: any, messages: any[]) {
  const guestName = reservation.guest?.fullName ?? "Unknown";
  const checkIn = reservation.checkIn ?? "";
  const checkOut = reservation.checkOut ?? "";
  const listing = reservation.listing?.title ?? "";
  const source = reservation.source ?? reservation.channel ?? "Unknown";
  const stayStatus = getStayStatus(checkIn, checkOut);

  const conversation = messages
    .map((m: any) => `${m.senderType}: ${m.body}`)
    .join("\n");

  const prompt = `You are a WOW hospitality agent for O&O Group, a vacation rental company.

Your philosophy is rooted in "Unreasonable Hospitality" by Will Guidara and Tony Hsieh's approach.
A WOW moment comes from LISTENING to what the guest actually said — not from guessing based on their name, nationality, or dates.
The hot dog story: the guest MENTIONED they never had a New York hot dog. That's what made the gesture possible. Without that detail, there would be no gesture.
If the guest hasn't revealed anything personal, there is NO opportunity. Silence is the right answer.

Guest: ${guestName}
Property: ${listing}
Check-in: ${checkIn}
Check-out: ${checkOut}
Stay status: ${stayStatus}
Booking source: ${source}

Conversation history (this is your ONLY source of truth):
${conversation || "No messages yet"}

STRICT RULES:
1. Only identify an opportunity if the guest explicitly mentioned something personal in the conversation — a special occasion, a preference, a fear, a dream, a reason for the trip, something they love or miss.
2. Do NOT guess based on: guest name, nationality, religion, check-in date proximity to holidays, or property location.
3. If there are no messages or nothing personal was shared — answer OPPORTUNITY: no.
4. The suggestion must be specific, small, and genuinely personal — not generic hospitality.
5. Returning guests who have stayed before deserve extra attention even with little context.

Answer in this exact format and nothing else:
OPPORTUNITY: yes/no
WHAT: [max 2 lines — the specific action to take]
WHY: [max 2 lines — the exact detail from the conversation that led to this]
`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

const processedReservations = new Set<string>();
const lastMessageCount: Record<string, number> = {};

async function pollGuesty() {
  console.log("Polling Guesty...");
  try {
    const reservations = await getRecentReservations();

    for (const reservation of reservations) {
      const id = reservation._id;
      const isNew = !processedReservations.has(id);
      const messages = await getReservationMessages(id);
      const messageCount = messages.length;
      const hasNewMessages = lastMessageCount[id] !== messageCount;

      console.log(`Reservation ${id}: isNew=${isNew}, messages=${messageCount}, hasNewMessages=${hasNewMessages}`);

      if (!isNew && !hasNewMessages) continue;

      processedReservations.add(id);
      lastMessageCount[id] = messageCount;

      console.log(`Analyzing reservation ${id} (${reservation.guest?.fullName})...`);
      const analysis = await analyzeConversation(reservation, messages);
      console.log(`Analysis for ${id}: ${analysis.substring(0, 100)}`);

      if (!analysis.includes("OPPORTUNITY: yes")) continue;

      const guestName = reservation.guest?.fullName ?? "Guest";
      const checkIn = reservation.checkIn ?? "";
      const checkOut = reservation.checkOut ?? "";
      const listing = reservation.listing?.title ?? "";
      const source = reservation.source ?? reservation.channel ?? "Unknown";
      const stayStatus = getStayStatus(checkIn, checkOut);
      const channel = getChannel(listing);

      const what = analysis.match(/WHAT:(.*?)(?=WHY:|$)/s)?.[1]?.trim() ?? "";
      const why = analysis.match(/WHY:(.*?)$/s)?.[1]?.trim() ?? "";

      const message = `*WOW Opportunity* 🌟

*שם אורח:* ${guestName}
*תאריכי שהייה:* ${checkIn} → ${checkOut}
*סטטוס:* ${stayStatus}
*ספק:* ${source}

*מה ההזדמנות:*
${what}

*למה זו הזדמנות:*
${why}`.trim();

      await sendSlackMessage(channel, message);
      console.log(`Sent to ${channel} — ${guestName}`);
    }
  } catch (err) {
    console.error("Polling error:", err);
  }
}

app.post("/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const event = req.body;
    const reservationId = event.data?.reservationId ?? event.reservationId;
    console.log("WEBHOOK PAYLOAD:", JSON.stringify(event, null, 2));
    if (!reservationId) return;

    console.log(`Webhook received for reservation ${reservationId}`);

    const token = await getGuestyToken();
    const resData = await fetch(
      `https://open-api.guesty.com/v1/reservations/${reservationId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const reservation = await resData.json() as any;
    const messages = await getReservationMessages(reservationId);

    const analysis = await analyzeConversation(reservation, messages);
    if (!analysis.includes("OPPORTUNITY: yes")) return;

    const guestName = reservation.guest?.fullName ?? "Guest";
    const checkIn = reservation.checkIn ?? "";
    const checkOut = reservation.checkOut ?? "";
    const listing = reservation.listing?.title ?? "";
    const source = reservation.source ?? reservation.channel ?? "Unknown";
    const stayStatus = getStayStatus(checkIn, checkOut);
    const channel = getChannel(listing);

    const what = analysis.match(/WHAT:(.*?)(?=WHY:|$)/s)?.[1]?.trim() ?? "";
    const why = analysis.match(/WHY:(.*?)$/s)?.[1]?.trim() ?? "";

    const message = `*WOW Opportunity* 🌟\n\n*שם אורח:* ${guestName}\n*תאריכי שהייה:* ${checkIn} → ${checkOut}\n*סטטוס:* ${stayStatus}\n*ספק:* ${source}\n\n*מה ההזדמנות:*\n${what}\n\n*למה זו הזדמנות:*\n${why}`.trim();

    await sendSlackMessage(channel, message);
    console.log(`Sent to ${channel} — ${guestName}`);
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