import type { Request, Response } from "express";
import { createLogger } from "../lib/logger.js";
import { getListing, getReservation } from "../services/guesty.js";
import { buildAlertParams, sendAlert } from "../services/slack.js";
import { analyze } from "../services/analyzer.js";
import type { GuestyMessage, WebhookContext } from "../types.js";

const log = createLogger("webhook");

function extractContext(event: any): WebhookContext {
  const conversation = event?.conversation ?? {};
  const thread: GuestyMessage[] = conversation.thread ?? [];
  const meta = conversation.meta ?? {};
  const firstReservation = meta.reservations?.[0];

  const guestMessages = thread
    .filter((m) => m.type === "fromGuest")
    .map((m) => m.body)
    .filter((b) => typeof b === "string" && b.trim().length > 0)
    .join("\n");

  const reservationId =
    event?.reservationId ??
    event?.reservation?._id ??
    firstReservation?._id ??
    conversation.reservationId ??
    null;

  const conversationId = conversation._id ?? event?.conversationId ?? null;

  return {
    reservationId,
    conversationId,
    guestName: meta.guestName ?? firstReservation?.guest?.fullName ?? "Guest",
    guestMessages,
    checkIn: firstReservation?.checkIn ?? null,
    checkOut: firstReservation?.checkOut ?? null,
    source: firstReservation?.source ?? null,
  };
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  res.sendStatus(200);

  try {
    const event = req.body;
    log.info("Webhook received");
    log.debug("Full payload", event);

    const ctx = extractContext(event);
    log.debug("Extracted context", ctx);

    if (!ctx.guestMessages) {
      log.info("No guest messages found, skipping");
      return;
    }

    let listingTitle = "Unknown";
    let country = "";
    let checkIn = ctx.checkIn;
    let checkOut = ctx.checkOut;
    let source = ctx.source;
    let guestName = ctx.guestName;

    if (ctx.reservationId) {
      const reservation = await getReservation(ctx.reservationId);
      if (reservation) {
        checkIn = checkIn ?? reservation.checkIn;
        checkOut = checkOut ?? reservation.checkOut;
        source = source ?? reservation.source;
        if (guestName === "Guest" && reservation.guestName) {
          guestName = reservation.guestName;
        }
        if (reservation.listingId) {
          const listing = await getListing(reservation.listingId);
          if (listing) {
            listingTitle = listing.title;
            country = listing.country;
          }
        }
      }
    }

    log.info("Context resolved", {
      guestName,
      listingTitle,
      country,
      source,
    });

    const analysis = await analyze(guestName, ctx.guestMessages);
    log.info("Analysis result", { isOpportunity: analysis.isOpportunity });

    if (!analysis.isOpportunity) {
      log.info("No opportunity identified");
      return;
    }

    const alertParams = buildAlertParams({
      country,
      guestName,
      listingTitle,
      checkIn,
      checkOut,
      source,
      what: analysis.what,
      why: analysis.why,
    });

    await sendAlert(alertParams);
  } catch (err) {
    log.error("Webhook handler error", { error: String(err) });
  }
}