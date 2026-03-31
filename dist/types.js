"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WowOpportunitySchema = void 0;
const zod_1 = require("zod");
// ─── WOW Analysis ────────────────────────────────────────────────────────────
exports.WowOpportunitySchema = zod_1.z.object({
    isOpportunity: zod_1.z.boolean().describe("True if this message contains a genuine WOW moment opportunity"),
    opportunityType: zod_1.z.enum([
        "special_occasion", // birthday, anniversary, honeymoon, graduation
        "preference", // dietary, accessibility, pillow type, etc.
        "loyalty", // returning guest, long-time fan
        "service_recovery", // complaint we can turn around
        "proactive_help", // need we can anticipate before they ask
    ]).nullable().describe("The category of WOW opportunity, or null if none"),
    urgency: zod_1.z.enum(["high", "medium", "low"]).describe("high = act before check-in or within hours; medium = within the day; low = nice to do"),
    headline: zod_1.z.string().describe("One punchy sentence summarizing the opportunity for the ops team, e.g. 'Anniversary couple arriving tomorrow — surprise them'"),
    suggestedActions: zod_1.z.array(zod_1.z.string()).describe("2–4 concrete actions staff can take right now"),
    guestContext: zod_1.z.string().describe("Brief summary of what the guest said / needs, in plain English for the team"),
});
