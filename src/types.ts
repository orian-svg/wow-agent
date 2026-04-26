export interface GuestyListing {
  id: string;
  title: string;
  country: string;
  city: string;
}

export interface GuestyReservation {
  id: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  source: string;
  guestName: string;
}

export interface GuestyMessage {
  body: string;
  type: "fromGuest" | "fromHost" | "system";
  createdAt?: string;
}

export interface WebhookContext {
  reservationId: string | null;
  conversationId: string | null;
  guestName: string;
  guestMessages: string;
  checkIn: string | null;
  checkOut: string | null;
  source: string | null;
}

export interface WowAnalysis {
  isOpportunity: boolean;
  what: string;
  why: string;
}

export interface SlackAlertParams {
  channel: string;
  guestName: string;
  listingTitle: string;
  checkIn: string;
  checkOut: string;
  source: string;
  what: string;
  why: string;
}