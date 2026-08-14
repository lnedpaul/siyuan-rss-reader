import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("siyuan", () => {
    return {
        Plugin: class {
            i18n: Record<string, string> = {};
            loadData: any = async () => null;
            saveData: any = async () => { };
            app: any = {};
        },
        showMessage: vi.fn(),
        Dialog: class {
            element: HTMLElement | null = null;
            destroy() { }
        },
        fetchSyncPost: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        openTab: vi.fn(),
    };
});

import RSSReaderPlugin from "./index";

function makeArticle(i: number): any {
    return {
        id: `a${i}`,
        title: `Article ${i}`,
        link: `https://example.com/${i}`,
        pubDate: new Date(Date.now() - i * 60000).toISOString(),
        content: "",
        description: "",
        subscriptionId: "s1",
        isRead: false,
    };
}

function createContainer(): HTMLElement {
    const container = document.createElement("div");
    container.innerHTML = `
        <div id="rssArticleList" style="overflow-y:auto;height:500px;"></div>
        <div id="rssList"></div>
        <div id="articleCount"></div>
        <div id="rssArticleContent"></div>
    `;
    return container;
}

describe("infinite scroll state machine", () => {
    let plugin: any;
    let container: HTMLElement;
    let list: HTMLElement;

    beforeEach(() => {
        // jsdom has no requestAnimationFrame; polyfill it so the
        // checkAndLoadMore backfill chain (which uses rAF) works in tests.
        if (!globalThis.requestAnimationFrame) {
            globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
                setTimeout(() => cb(Date.now()), 16) as unknown as number;
        }
        if (!globalThis.cancelAnimationFrame) {
            globalThis.cancelAnimationFrame = clearTimeout as unknown as (id: number) => void;
        }
        plugin = new RSSReaderPlugin({} as any);
        plugin.settings = {
            articlesPerPage: 20,
            fontSize: 14,
            layout: "vertical",
            autoMarkRead: true,
            autoRefreshInterval: 0,
            useTemplate: false,
            templateShowLink: true,
            templateShowSiteName: true,
            templateShowDateTime: true,
            enableKeyboardShortcuts: true,
            deviceId: "test-device",
        };
        plugin.i18n = {
            noArticles: "No articles",
            loadMore: "Load more",
            selectArticle: "Select",
            loading: "Loading",
        };
        container = createContainer();
        plugin.container = container;
        list = container.querySelector("#rssArticleList") as HTMLElement;
    });

    it("renders first page then appends next page on scroll to bottom", async () => {
        plugin.currentArticles = Array.from({ length: 45 }, (_, i) => makeArticle(i));
        plugin.displayedArticleCount = 0;
        plugin.isLoadingMore = false;

        plugin.renderArticleList(container);
        expect(plugin.displayedArticleCount).toBe(20);
        expect(list.querySelectorAll(".article-item").length).toBe(20);

        // Simulate a container that page 1 already fills, so the auto-backfill
        // (scrollHeight <= clientHeight + 10) does NOT kick in and the scroll
        // path is tested in isolation.
        Object.defineProperty(list, "scrollHeight", { value: 5000, configurable: true });
        Object.defineProperty(list, "clientHeight", { value: 500, configurable: true });

        plugin.setupInfiniteScroll(container);
        Object.defineProperty(list, "scrollTop", { value: 4900, configurable: true });

        list.dispatchEvent(new Event("scroll"));
        await new Promise(r => setTimeout(r, 300));

        expect(plugin.displayedArticleCount).toBe(40);
        expect(list.querySelectorAll(".article-item").length).toBe(40);
    });

    it("backfills first screen after full re-render (infinite scroll regression)", async () => {
        // Regression: after a FULL re-render (append=false, e.g. mark-all-read or
        // layout switch), displayedArticleCount resets to 0. If page 1 does not
        // fill the container, no scrollbar exists, no scroll event fires and the
        // remaining articles could never load. The backfill must kick in.
        plugin.currentArticles = Array.from({ length: 45 }, (_, i) => makeArticle(i));
        plugin.displayedArticleCount = 0;
        plugin.isLoadingMore = false;

        plugin.renderArticleList(container);
        expect(plugin.displayedArticleCount).toBe(20);

        // jsdom reports scrollHeight/clientHeight as 0, so the backfill chain
        // keeps appending until everything is loaded.
        await new Promise(r => setTimeout(r, 900));

        expect(plugin.displayedArticleCount).toBe(45);
        expect(plugin.isLoadingMore).toBe(false);
        expect(list.querySelectorAll(".article-item").length).toBe(45);
    });

    it("scroll handler unlocks isLoadingMore after append (no deadlock)", async () => {
        plugin.currentArticles = Array.from({ length: 30 }, (_, i) => makeArticle(i));
        plugin.displayedArticleCount = 0;
        plugin.isLoadingMore = false;

        plugin.renderArticleList(container);
        // Block auto-backfill so the scroll path is isolated.
        Object.defineProperty(list, "scrollHeight", { value: 5000, configurable: true });
        Object.defineProperty(list, "clientHeight", { value: 500, configurable: true });

        plugin.setupInfiniteScroll(container);
        Object.defineProperty(list, "scrollTop", { value: 4900, configurable: true });

        list.dispatchEvent(new Event("scroll"));
        await new Promise(r => setTimeout(r, 300));
        expect(plugin.isLoadingMore).toBe(true); // append in flight (500ms lock)

        await new Promise(r => setTimeout(r, 400)); // wait for the 500ms unlock
        expect(plugin.isLoadingMore).toBe(false);
    });
});
