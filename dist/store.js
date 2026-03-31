"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addOpportunity = addOpportunity;
exports.getOpportunities = getOpportunities;
exports.getOpportunityCount = getOpportunityCount;
const MAX_ENTRIES = 200;
const log = [];
function addOpportunity(ctx) {
    const entry = {
        ...ctx,
        id: `opp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        detectedAt: new Date().toISOString(),
    };
    log.unshift(entry); // newest first
    if (log.length > MAX_ENTRIES)
        log.splice(MAX_ENTRIES);
    return entry;
}
function getOpportunities(limit = 50, offset = 0) {
    return log.slice(offset, offset + limit);
}
function getOpportunityCount() {
    return log.length;
}
