import { z } from "zod";

// ─── Guesty Webhook ──────────────────────────────────────────────────────────

export interface GuestyGuest {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export interface GuestyReservation {
  _id: string;
  checkIn: string;   // ISO date
  checkOut: string;  // ISO date
  listingId: string;
  listingName?: string;
  status: string;
  nightsCount?: number;
}

export interface GuestyMessage {
  _id: string;
  body: string;
  createdAt: string;
  type: "guest" | "host" | "system";
}

export interface GuestyWebhookPayload {
  event: string;  // e.g. "reservation.message.created"
  data: {
    guest?: GuestyGuest;
    reservation?: GuestyReservation;
    message?: GuestyMessage;
  };
}

// ─── WOW Analysis ────────────────────────────────────────────────────────────

export const WowOpportunitySchema = z.object({
  isOpportunity: z.boolean().describe(
    "True if this message contains a genuine WOW moment opportunity"
  ),
  opportunityType: z.enum([
    "special_occasion",   // birthday, anniversary, honeymoon, graduation
    "preference",         // dietary, accessibility, pillow type, etc.
    "loyalty",            // returning guest, long-time fan
    "service_recovery",   // complaint we can turn around
    "proactive_help",     // need we can anticipate before they ask
  ]).nullable().describe("The category of WOW opportunity, or null if none"),
  urgency: z.enum(["high", "medium", "low"]).describe(
    "high = act before check-in or within hours; medium = within the day; low = nice to do"
  ),
  headline: z.string().describe(
    "One punchy sentence summarizing the opportunity for the ops team, e.g. 'Anniversary couple arriving tomorrow — surprise them'"
  ),
  suggestedActions: z.array(z.string()).describe(
    "2–4 concrete actions staff can take right now"
  ),
  guestContext: z.string().describe(
    "Brief summary of what the guest said / needs, in plain English for the team"
  ),
});

export type WowOpportunity = z.infer<typeof WowOpportunitySchema>;

// ─── Alert ───────────────────────────────────────────────────────────────────

export interface AlertContext {
  opportunity: WowOpportunity;
  guest: GuestyGuest | undefined;
  reservation: GuestyReservation | undefined;
  originalMessage: string;
}
