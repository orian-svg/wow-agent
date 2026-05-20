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
exports.getPastOpportunities = getPastOpportunities;
exports.recordOpportunity = recordOpportunity;
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
