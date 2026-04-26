"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cache = void 0;
class Cache {
    store = new Map();
    ttlMs;
    constructor(ttlMinutes) {
        this.ttlMs = ttlMinutes * 60 * 1000;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }
    set(key, value) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }
    has(key) {
        return this.get(key) !== null;
    }
    clear() {
        this.store.clear();
    }
    size() {
        return this.store.size;
    }
}
exports.Cache = Cache;
