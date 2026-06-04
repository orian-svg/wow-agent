import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { markManuallyResolved } from "../lib/memory.js";
import { Redis } from "@upstash/redis";

const log = createLogger("slack-events");

export async function slackEventsHandler(req: Request, res: Response): Promise<void> {
  const body = req.body;

  // אימות URL מסלאק — חייב להגיב מיד ללא אימות חתימה
  if (body.type === "url_verification") {
    log.info("Slack URL verification challenge received");
    res.json({ challenge: body.challenge });
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