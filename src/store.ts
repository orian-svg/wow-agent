import type { AlertContext } from "./types.js";

export interface LoggedOpportunity extends AlertContext {
  id: string;
  detectedAt: string;
}

const MAX_ENTRIES = 200;
const log: LoggedOpportunity[] = [];

export function addOpportunity(ctx: AlertContext): LoggedOpportunity {
  const entry: LoggedOpportunity = {
    ...ctx,
    id: `opp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    detectedAt: new Date().toISOString(),
  };
  log.unshift(entry); // newest first
  if (log.length > MAX_ENTRIES) log.splice(MAX_ENTRIES);
  return entry;
}

export function getOpportunities(limit = 50, offset = 0): LoggedOpportunity[] {
  return log.slice(offset, offset + limit);
}

export function getOpportunityCount(): number {
  return log.length;
}
