import { describe, it, expect } from "vitest";
import { formatDate, formatUnreadCount, generateArticleId } from "./utils";

describe("formatDate", () => {
    it("formats a valid date", () => {
        const result = formatDate("2024-01-15T10:30:00Z");
        expect(result).toContain("2024");
        expect(result).toContain("15");
    });

    it("returns empty string for null", () => {
        expect(formatDate(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
        expect(formatDate(undefined)).toBe("");
    });

    it("returns empty string for invalid date", () => {
        expect(formatDate("not-a-date")).toBe("");
    });

    it("handles RFC 2822 date", () => {
        const result = formatDate("Mon, 15 Jan 2024 10:30:00 GMT");
        expect(result).toContain("2024");
    });
});

describe("formatUnreadCount", () => {
    it("returns string for small numbers", () => {
        expect(formatUnreadCount(5)).toBe("5");
    });

    it("uses + format for 100+", () => {
        expect(formatUnreadCount(100)).toBe("99+");
        expect(formatUnreadCount(150)).toBe("99+");
    });

    it("clamps negative to 0", () => {
        expect(formatUnreadCount(-5)).toBe("0");
    });

    it("returns 0 for 0", () => {
        expect(formatUnreadCount(0)).toBe("0");
    });
});

describe("generateArticleId", () => {
    it("returns consistent hash for same inputs", () => {
        const a = generateArticleId("https://example.com/post1", "Title", "2024-01-15");
        const b = generateArticleId("https://example.com/post1", "Title", "2024-01-15");
        expect(a).toBe(b);
    });

    it("returns different hashes for different inputs", () => {
        const a = generateArticleId("https://example.com/post1", "Title A", "2024-01-15");
        const b = generateArticleId("https://example.com/post2", "Title B", "2024-01-16");
        expect(a).not.toBe(b);
    });

    it("uses link when title and pubDate are missing", () => {
        const id = generateArticleId("https://example.com/post", undefined, undefined);
        expect(id).toBeTruthy();
        expect(id.length).toBe(14);
    });
});
