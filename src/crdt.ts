export interface CRDTSubscription {
    id: string;
    version: number;
    deviceId: string;
    updatedAt: number;
    deleted?: boolean;
}

/**
 * CRDT merge: deterministic conflict resolution between two subscription versions.
 * Rules:
 *   1. DELETED always wins
 *   2. Same deviceId → higher version wins
 *   3. Different deviceId → version-based tiebreaker with fallback to updatedAt
 */
export function resolveSubscriptionConflict<T extends CRDTSubscription>(a: T, b: T): T {
    if (a.deleted) return a;
    if (b.deleted) return b;

    const verA = a.version || 0;
    const verB = b.version || 0;

    if (a.deviceId === b.deviceId) {
        return verA > verB ? a : b;
    }

    const timeA = a.updatedAt || 0;
    const timeB = b.updatedAt || 0;

    // Large version gap: clearly newer
    if (Math.abs(verA - verB) >= 3) {
        return verA > verB ? a : b;
    }

    // Small version gap: use time with 5-min clock skew tolerance
    if (Math.abs(timeA - timeB) > 300000) {
        return timeA > timeB ? a : b;
    }

    // Stalemate: deterministic tiebreaker (deviceId lexicographic)
    return a.deviceId > b.deviceId ? a : b;
}
