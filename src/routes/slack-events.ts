import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { markManuallyResolved } from "../lib/memory.js";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const log = createLogger("slack-events");

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";

function verifySlackSignature(req: Request): boolean {
  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const signature = req.headers["x-slack-signature"] as string;
  if (!timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;
  const rawBody = JSON.stringify(req.body);
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", SIGNING_SECRET);
  hmac.update(sigBase);
  const computed = `v0=${hmac.digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

export async function slackEventsHandler(req: Request, res: Response): Promise<void> {
  const body = req.body;

  if (body.type === "url_verification") {
    res.json({ challenge: body.challenge });
    return;
  }

  if (SIGNING_SECRET && !verifySlackSignature(req)) {
    log.warn("Invalid Slack signature");
    res.sendStatus(401);
    return;
  }

  res.sendStatus(200);

  try {
    const event = body.event;
    if (!event) return;
    if (event.type !== "message" || event.subtype || !event.thread_ts) return;
    if (event.bot_id) return;

    const text = (event.text ?? "").trim().toLowerCase();
    if (text !== "!resolved") return;

    const threadTs = event.thread_ts;
    log.info(`!resolved command received for thread ${threadTs}`);

    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    const keys = await redis.keys("res:*");
    for (const key of keys) {
      const data = await redis.get<any>(key);
      if (data?.unhappySlackTs === threadTs) {
        const resId = key.replace("res:", "");
        await markManuallyResolved(resId);
        log.info(`Reservation ${resId} manually resolved via !resolved command`);
        return;
      }
    }

    log.warn(`No reservation found for thread ${threadTs}`);
  } catch (err) {
    log.error("Slack events handler error", { error: String(err) });
  }
}
