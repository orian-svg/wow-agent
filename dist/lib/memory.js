"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.URGENCY_RANK = void 0;
exports.getPastOpportunities = getPastOpportunities;
exports.recordOpportunity = recordOpportunity;
exports.getLastUnhappyUrgency = getLastUnhappyUrgency;
exports.getUnhappyThreadTs = getUnhappyThreadTs;
exports.recordUnhappyAlert = recordUnhappyAlert;
exports.saveConversation = saveConversation;
exports.getAllActiveConversations = getAllActiveConversations;
const logger_js_1 = require("./logger.js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const log = (0, logger_js_1.createLogger)("memory");
const MEMORY_FILE = path.resolve("./data/memory.json");
function loadStore() {
    try {
        if (!fs.existsSync(MEMORY_FILE))
            return {};
        const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        log.warn("Could not load memory file, starting fresh");
        return {};
    }
}
function saveStore(store) {
    try {
        const dir = path.dirname(MEMORY_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf-8");
    }
    catch (err) {
        log.error("Could not save memory file", { error: String(err) });
    }
}
function getPastOpportunities(reservationId) {
    const store = loadStore();
    return store[reservationId]?.sentOpportunities ?? [];
}
function recordOpportunity(reservationId, why) {
    const store = loadStore();
    if (!store[reservationId]) {
        store[reservationId] = { sentOpportunities: [] };
    }
    store[reservationId].sentOpportunities.push(why);
    saveStore(store);
    log.info(`Recorded opportunity for reservation ${reservationId}`);
}
exports.URGENCY_RANK = {
    resolved: -1,
    low: 0,
    medium: 1,
    high: 2,
};
function getLastUnhappyUrgency(reservationId) {
    const store = loadStore();
    return store[reservationId]?.lastUnhappyUrgency;
}
function getUnhappyThreadTs(reservationId) {
    const store = loadStore();
    return store[reservationId]?.unhappySlackTs;
}
function recordUnhappyAlert(reservationId, urgency, slackTs) {
    const store = loadStore();
    if (!store[reservationId]) {
        store[reservationId] = { sentOpportunities: [] };
    }
    store[reservationId].lastUnhappyUrgency = urgency;
    if (slackTs) {
        store[reservationId].unhappySlackTs = slackTs;
    }
    saveStore(store);
    log.info(`Recorded unhappy alert for reservation ${reservationId} (urgency: ${urgency})`);
}
// שמירת השיחה המצטברת לדוח היומי
function saveConversation(reservationId, messages, meta) {
    const store = loadStore();
    if (!store[reservationId]) {
        store[reservationId] = { sentOpportunities: [] };
    }
    store[reservationId].conversationMessages = messages;
    store[reservationId].guestName = meta.guestName;
    store[reservationId].listingNickname = meta.listingNickname;
    store[reservationId].country = meta.country;
    store[reservationId].checkIn = meta.checkIn;
    store[reservationId].checkOut = meta.checkOut;
    store[reservationId].source = meta.source;
    store[reservationId].lastUpdated = new Date().toISOString();
    saveStore(store);
}
// שליפת כל ההזמנות שיש להן שיחה שמורה
function getAllActiveConversations() {
    const store = loadStore();
    const results = [];
    for (const [reservationId, data] of Object.entries(store)) {
        if (!data.conversationMessages || !data.guestName)
            continue;
        // מסנן הזמנות ישנות שהצ'ק-אאוט שלהן עבר יותר מ-2 ימים
        if (data.checkOut) {
            const checkOut = new Date(data.checkOut);
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            if (checkOut < twoDaysAgo)
                continue;
        }
        results.push({
            reservationId,
            messages: data.conversationMessages,
            guestName: data.guestName,
            listingNickname: data.listingNickname ?? "Unknown",
            country: data.country ?? "",
            checkIn: data.checkIn ?? "",
            checkOut: data.checkOut ?? "",
            source: data.source ?? "",
            lastUpdated: data.lastUpdated ?? "",
        });
    }
    return results;
}
