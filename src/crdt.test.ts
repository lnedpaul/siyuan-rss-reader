import { describe, it, expect } from "vitest";
import { resolveSubscriptionConflict } from "./crdt";
import type { CRDTSubscription } from "./crdt";

function sub(overrides: Partial<CRDTSubscription> = {}): CRDTSubscription {
    return {
        id: "test_1",
        version: 1,
        deviceId: "dev_a",
        updatedAt: 1000,
        ...overrides,
    };
}

describe("resolveSubscriptionConflict", () => {

    it("deleted wins over non-deleted", () => {
        const a = sub({ deleted: true, version: 1 });
        const b = sub({ deleted: false, version: 99, deviceId: "dev_b" });
        expect(resolveSubscriptionConflict(a, b)).toBe(a);
        expect(resolveSubscriptionConflict(b, a)).toBe(a);
    });

    it("deleted wins over deleted (first wins)", () => {
        const a = sub({ deleted: true, version: 1 });
        const b = sub({ deleted: true, version: 99 });
        expect(resolveSubscriptionConflict(a, b)).toBe(a);
    });

    it("same deviceId: higher version wins", () => {
        const a = sub({ version: 10, deviceId: "dev_x" });
        const b = sub({ version: 5, deviceId: "dev_x" });
        expect(resolveSubscriptionConflict(a, b)).toBe(a);
    });

    it("same deviceId: lower version loses", () => {
        const a = sub({ version: 3, deviceId: "dev_x" });
        const b = sub({ version: 7, deviceId: "dev_x" });
        expect(resolveSubscriptionConflict(a, b)).toBe(b);
    });

    it("diff deviceId, version gap >= 3: higher version wins", () => {
        const a = sub({ version: 10, deviceId: "dev_a", updatedAt: 0 });
        const b = sub({ version: 1, deviceId: "dev_b", updatedAt: 999999 });
        expect(resolveSubscriptionConflict(a, b)).toBe(a);
    });

    it("diff deviceId, version gap < 3, time gap > 5min: newer wins", () => {
        const a = sub({ version: 5, deviceId: "dev_a", updatedAt: 1000 });
        const b = sub({ version: 4, deviceId: "dev_b", updatedAt: 400000 });
        expect(resolveSubscriptionConflict(a, b)).toBe(b);
    });

    it("diff deviceId, version gap < 3, time gap within 5min: stalemate => deviceId tiebreak", () => {
        const a = sub({ version: 2, deviceId: "dev_b", updatedAt: 1000 });
        const b = sub({ version: 1, deviceId: "dev_a", updatedAt: 1001 });
        // "dev_b" > "dev_a" lexicographically
        expect(resolveSubscriptionConflict(a, b)).toBe(a);
    });

    it("stalemate tiebreaker: lexicographically later deviceId wins", () => {
        const a = sub({ version: 1, deviceId: "z_dev", updatedAt: 1000 });
        const b = sub({ version: 1, deviceId: "a_dev", updatedAt: 1000 });
        expect(resolveSubscriptionConflict(a, b)).toBe(a);
    });

    it("preserves full object of the winner, not a copy", () => {
        const a = sub({ id: "s1", version: 5, deviceId: "dev_x" });
        const b = sub({ id: "s1", version: 3, deviceId: "dev_x" });
        const result = resolveSubscriptionConflict(a, b);
        expect(result).toBe(a);
        expect(result.id).toBe("s1");
    });

    it("zero version treated as 0 — returns b (second) when equal", () => {
        const a = sub({ version: 0, deviceId: "dev_x" });
        const b = sub({ version: 0, deviceId: "dev_x" });
        // equal, returns b (else branch of verA > verB)
        expect(resolveSubscriptionConflict(a, b)).toBe(b);
    });

    it("undefined version treated as 0", () => {
        const a = sub({ version: undefined as unknown as number, deviceId: "dev_x" });
        const b = sub({ version: 0, deviceId: "dev_x" });
        expect(resolveSubscriptionConflict(a, b)).toBe(b);
    });
});

describe("onDataChanged write-back condition", () => {
    it("identical merge result skips write", () => {
        const incoming = [
            { id: "s1", version: 3, deviceId: "dev_a", updatedAt: 1000 },
        ];
        const memory = [
            { id: "s1", version: 3, deviceId: "dev_a", updatedAt: 1000 },
        ];

        const merged = new Map<string, CRDTSubscription>();
        memory.forEach(s => merged.set(s.id, s));
        incoming.forEach(s => {
            const existing = merged.get(s.id);
            if (!existing) {
                merged.set(s.id, s);
            } else {
                merged.set(s.id, resolveSubscriptionConflict(existing, s));
            }
        });

        const mergedArray = Array.from(merged.values());
        expect(JSON.stringify(incoming)).toBe(JSON.stringify(mergedArray));
    });

    it("local winner triggers write-back", () => {
        const incoming = [
            { id: "s1", version: 2, deviceId: "dev_a", updatedAt: 1000 },
        ];
        const memory = [
            { id: "s1", version: 5, deviceId: "dev_b", updatedAt: 2000 },
        ];

        // memory version=5, gap=3 >=3 → higher version wins → dev_b version wins
        const merged = new Map<string, CRDTSubscription>();
        memory.forEach(s => merged.set(s.id, s));
        incoming.forEach(s => {
            const existing = merged.get(s.id);
            if (!existing) {
                merged.set(s.id, s);
            } else {
                merged.set(s.id, resolveSubscriptionConflict(existing, s));
            }
        });

        const mergedArray = Array.from(merged.values());
        expect(JSON.stringify(incoming)).not.toBe(JSON.stringify(mergedArray));
        expect(mergedArray[0].version).toBe(5);
    });

    it("remote winner skips write-back", () => {
        const incoming = [
            { id: "s1", version: 5, deviceId: "dev_a", updatedAt: 2000 },
        ];
        const memory = [
            { id: "s1", version: 2, deviceId: "dev_b", updatedAt: 1000 },
        ];

        // incoming version=5, gap=3 >=3 → higher version wins → dev_a version wins
        const merged = new Map<string, CRDTSubscription>();
        memory.forEach(s => merged.set(s.id, s));
        incoming.forEach(s => {
            const existing = merged.get(s.id);
            if (!existing) {
                merged.set(s.id, s);
            } else {
                merged.set(s.id, resolveSubscriptionConflict(existing, s));
            }
        });

        const mergedArray = Array.from(merged.values());
        expect(JSON.stringify(incoming)).toBe(JSON.stringify(mergedArray));
    });

    it("new subscription from sync triggers write-back", () => {
        const incoming = [
            { id: "s1", version: 1, deviceId: "dev_a", updatedAt: 1000 },
        ];
        const memory: CRDTSubscription[] = [];

        const merged = new Map<string, CRDTSubscription>();
        memory.forEach(s => merged.set(s.id, s));
        incoming.forEach(s => {
            const existing = merged.get(s.id);
            if (!existing) {
                merged.set(s.id, s);
            } else {
                merged.set(s.id, resolveSubscriptionConflict(existing, s));
            }
        });

        const mergedArray = Array.from(merged.values());
        expect(JSON.stringify(incoming)).toBe(JSON.stringify(mergedArray));
    });

    it("saveSubscriptionsWithMerge keeps soft-delete tombstone for sync (does not hard-delete)", () => {
        // Phase 2 semantics: local tombstone must be written back to storage so the
        // deletion can propagate to other devices — never dropped from the merged map.
        const stored = [
            { id: "s1", version: 1, deviceId: "dev_a", updatedAt: 1000 },
            { id: "s2", version: 1, deviceId: "dev_a", updatedAt: 1000 },
        ];
        const local = [
            { id: "s1", version: 2, deviceId: "dev_a", updatedAt: 2000, deleted: true },
            { id: "s2", version: 1, deviceId: "dev_a", updatedAt: 1000 },
        ];

        const mergedMap = new Map<string, CRDTSubscription>();
        stored.forEach(s => mergedMap.set(s.id, s));
        const deletedIds = new Set<string>();
        local.forEach(s => {
            if (s.deleted) {
                deletedIds.add(s.id);
                mergedMap.set(s.id, s);
                return;
            }
            const existingSub = mergedMap.get(s.id);
            if (!existingSub) {
                mergedMap.set(s.id, s);
            } else if (existingSub.deleted) {
                mergedMap.set(s.id, s);
            } else {
                mergedMap.set(s.id, resolveSubscriptionConflict(s, existingSub));
            }
        });

        const mergedArray = Array.from(mergedMap.values());
        const s1 = mergedArray.find(s => s.id === "s1");
        expect(s1?.deleted).toBe(true);
        expect(s1?.version).toBe(2);
        expect(mergedArray).toHaveLength(2);
        expect(deletedIds.has("s1")).toBe(true);
    });

    it("incoming tombstone marks subscription deleted on this device (no resurrection)", () => {
        // onDataChanged semantics: a tombstone synced from another device must win
        // over the local non-deleted copy, so the sub disappears from the UI for good.
        const incoming = [
            { id: "s1", version: 3, deviceId: "dev_b", updatedAt: 3000, deleted: true },
        ];
        const memory = [
            { id: "s1", version: 1, deviceId: "dev_a", updatedAt: 1000 },
        ];

        const merged = new Map<string, CRDTSubscription>();
        memory.forEach(s => merged.set(s.id, s));
        incoming.forEach(s => {
            const existing = merged.get(s.id);
            if (!existing) {
                merged.set(s.id, s);
            } else {
                merged.set(s.id, resolveSubscriptionConflict(existing, s));
            }
        });

        const mergedArray = Array.from(merged.values());
        expect(mergedArray[0].deleted).toBe(true);
        expect(mergedArray[0].deviceId).toBe("dev_b");
    });
});
