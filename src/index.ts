import {
    Plugin,
    showMessage,
    Dialog,
    fetchSyncPost,
    openTab,
} from "siyuan";

import "./index.scss";
import featuredFeedsData from './featured-feeds.json';

interface FeedCategory {
    category: string;
    categoryZh: string;
    items: Array<{ name: string; url: string }>;
}

interface FeaturedFeedsConfig {
    feeds: FeedCategory[];
}

// Flatten featured feeds from JSON config with type safety
const FEATURED_FEEDS = (featuredFeedsData as FeaturedFeedsConfig).feeds.flatMap(category => category.items);

// Debug mode control - set to false in production
const DEBUG = false;
const logger = {
    log: (...args: any[]) => DEBUG && console.log("[RSS]", ...args),
    warn: (...args: any[]) => DEBUG && console.warn("[RSS]", ...args),
    error: (...args: any[]) => console.error("[RSS]", ...args) // Always show errors
};

const TAB_TYPE = "rss_reader_tab";
const STORAGE_NAME = "rss_subscriptions";
const READ_STATUS_NAME = "rss_read_status";
const CACHED_ARTICLES_NAME = "rss_cached_articles";
const SETTINGS_NAME = "rss_settings";
const DEFAULT_ARTICLES_PER_PAGE = 20;
const MAX_CACHED_ARTICLES = 2000;
const FORWARD_PROXY_TIMEOUT = 30000;

interface Subscription {
    id: string;
    url: string;
    name: string;
    lastFetchTime?: number;
    createdAt: number;
    updatedAt: number;
    deleted?: boolean;
}

interface RSSItem {
    title: string;
    link: string;
    pubDate: string;
    content: string;
    description: string;
    author?: string;
}

interface Article extends RSSItem {
    id: string;
    subscriptionId: string;
    isRead?: boolean;
    cachedAt?: number;
    thumbnail?: string; // Cache extracted thumbnail URL to avoid regex on every render
}

interface ReadStatus {
    [articleId: string]: {
        isRead: boolean;
        readAt?: number;
    };
}

interface CachedArticleEntry {
    articles: Article[];
    cachedAt: number; // Timestamp when articles were cached
}

interface CachedArticles {
    [subscriptionId: string]: CachedArticleEntry;
}

interface FontSizeConfig {
    content: string;
    title: string;
    meta: string;
    listItem: string;
    listDesc: string;
    listDate: string;
    sliderLabel: string;
}

interface Settings {
    articlesPerPage: number;
    autoMarkRead: boolean;
    layout: 'horizontal' | 'vertical';
        enableKeyboardShortcuts: boolean;
        fontSize: number; // 12-20px
    autoRefreshInterval: number;
    lastUsedNotebookId?: string;
    useTemplate: boolean;
    templateShowLink: boolean;
    templateShowSiteName: boolean;
    templateShowDateTime: boolean;
}

const defaultSettings: Settings = {
    articlesPerPage: DEFAULT_ARTICLES_PER_PAGE,
    autoMarkRead: true,
    layout: 'vertical',
    enableKeyboardShortcuts: true,
    fontSize: 14,
    autoRefreshInterval: 0,
    lastUsedNotebookId: "",
    useTemplate: false,
    templateShowLink: true,
    templateShowSiteName: true,
    templateShowDateTime: true,
};

const SHORTCUTS = {
    NEXT_ARTICLE: 'j',
    PREV_ARTICLE: 'k',
    OPEN_ORIGINAL: 'o',
    SAVE_TO_SIYUAN: 's',
    REFRESH: 'r',
    MARK_ALL_READ: 'a',
    HELP: '?',
    PAGE_DOWN: ' '
};

export default class RSSReaderPlugin extends Plugin {
    private subscriptions: Subscription[] = [];
    private settings: Settings = defaultSettings;
    private currentSubscriptionIndex: number = -1;
    private displayedArticleCount: number = 0; // For infinite scroll
    private currentArticles: Article[] = [];
    private readStatus: ReadStatus = {};
    private currentArticleIndex: number = -1;
    private container: HTMLElement | null = null;
    private updateInterval: NodeJS.Timeout | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private boundHandleKeyboard!: (e: KeyboardEvent) => void;
    private listScrollHandler!: () => void;
    private isLoadingMore: boolean = false;
    private autoLoadRetryCount: number = 0; // Track auto-load retry count to prevent infinite loop
    // Resizer cleanup refs
    private resizerMoveHandler: ((e: MouseEvent) => void) | null = null;
    private resizerUpHandler: (() => void) | null = null;
    private vResizerMoveHandler: ((e: MouseEvent) => void) | null = null;
    private vResizerUpHandler: (() => void) | null = null;
    private isResizing: boolean = false;
    private initialWidth: number = 0;
    // Track all pending timeouts for cleanup
    private pendingTimeouts: NodeJS.Timeout[] = [];
    // Debounce timer for saving read status to prevent excessive writes
    private saveDebounceTimer: NodeJS.Timeout | null = null;
    // Throttle timer for scroll events to reduce performance overhead
    private scrollThrottleTimer: NodeJS.Timeout | null = null;
    // Track if subscription events are bound to prevent duplicates
    private subscriptionEventsBound: boolean = false;
    // Performance optimization: batch read status changes before saving
    private pendingReadStatusChanges: Map<string, { isRead: boolean; readAt: number }> = new Map();
    private readStatusSaveTimer: NodeJS.Timeout | null = null;
    // Request lock map to prevent duplicate concurrent requests per subscription (stores raw feed data)
    private pendingRequests: Map<string, Promise<{ items: RSSItem[] }>> = new Map();
    // Cache expiration time (5 minutes) - avoid unnecessary re-fetches
    private readonly CACHE_EXPIRY_MS = 5 * 60 * 1000;
    // Track last background fetch time per subscription to debounce rapid switches
    private lastBackgroundFetchTime: Map<string, number> = new Map();
    // Unread counts cache per subscription (for badge display on subscription list)
    private unreadCounts: Map<string, number> = new Map();
    // Performance metrics tracking
    private perfMetrics: {
        fetchCount: number;
        totalFetchTime: number;
        cacheHitCount: number;
        renderCount: number;
        totalRenderTime: number;
    } = {
        fetchCount: 0,
        totalFetchTime: 0,
        cacheHitCount: 0,
        renderCount: 0,
        totalRenderTime: 0
    };
        // MutationObserver instances for cleanup
    // Track if help dialog is currently open to prevent duplicates
    private isHelpDialogOpen: boolean = false;
    // Track the opened RSS Reader tab for cleanup
    private rssTab: any = null;
    private rssTabOpen: boolean = false;

    // ==================== Icon Registration ====================

    /**
     * Register custom SVG icons for the plugin
     * Icons are embedded directly to avoid webpack loader issues
     */
    private registerCustomIcons() {
        // SVG icon definitions - each symbol must have a unique id
        // IMPORTANT: Do NOT use ids that conflict with SiYuan built-in icons
        const icons = `
        <svg>
            <!-- Main RSS Icon for Dock (PRIMARY ICON - Must be registered first) -->
            <symbol id="iconRSSMain" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 11a9 9 0 0 1 9 9"></path>
                <path d="M4 4a16 16 0 0 1 16 16"></path>
                <circle cx="5" cy="19" r="1"></circle>
            </symbol>
            
            <!-- Add Icon -->
            <symbol id="iconRSSAdd" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 5H3"></path>
                <path d="M11 12H3"></path>
                <path d="M16 19H3"></path>
                <path d="M18 9v6"></path>
                <path d="M21 12h-6"></path>
            </symbol>
            
            <!-- Refresh Icon -->
            <symbol id="iconRSSRefresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m17 18-1.535 1.605a5 5 0 0 1-8-1.5"></path>
                <path d="M17 22v-4h-4"></path>
                <path d="M20.996 15.251A4.5 4.5 0 0 0 17.495 8h-1.79a7 7 0 1 0-12.709 5.607"></path>
                <path d="M7 10v4h4"></path>
                <path d="m7 14 1.535-1.605a5 5 0 0 1 8 1.5"></path>
            </symbol>
            
            <!-- Mark Read Icon -->
            <symbol id="iconRSSCheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 5h8"></path>
                <path d="M13 12h8"></path>
                <path d="M13 19h8"></path>
                <path d="m3 17 2 2 4-4"></path>
                <path d="m3 7 2 2 4-4"></path>
            </symbol>
            
            <!-- Help Icon -->
            <symbol id="iconRSSHelp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"></path>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <path d="M12 17h.01"></path>
            </symbol>
            
            <!-- Settings Icon -->
            <symbol id="iconRSSSettings" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 17H5"></path>
                <path d="M19 7h-9"></path>
                <circle cx="17" cy="17" r="3"></circle>
                <circle cx="7" cy="7" r="3"></circle>
            </symbol>
            
            <!-- Save Icon -->
            <symbol id="iconRSSSave" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v8"></path>
                <path d="m16 6-4 4-4-4"></path>
                <rect width="20" height="8" x="2" y="14" rx="2"></rect>
                <path d="M6 18h.01"></path>
                <path d="M10 18h.01"></path>
            </symbol>
            
            <!-- Delete Icon -->
            <symbol id="iconRSSDelete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 5H3"></path>
                <path d="M11 12H3"></path>
                <path d="M16 19H3"></path>
                <path d="m15.5 9.5 5 5"></path>
                <path d="m20.5 9.5-5 5"></path>
            </symbol>
            
            <!-- Minimize Icon -->
            <symbol id="iconRSSMinimize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m14 10 7-7"></path>
                <path d="M20 10h-6V4"></path>
                <path d="m3 21 7-7"></path>
                <path d="M4 14h6v6"></path>
            </symbol>
        </svg>`;
        
        // Register all icons with SiYuan using addIcons()
        // This must be called before addDock() to ensure icons are available
        this.addIcons(icons);
        
        logger.log('Custom icons registered successfully (9 icons): iconRSSMain, iconRSSAdd, iconRSSRefresh, iconRSSCheck, iconRSSHelp, iconRSSSettings, iconRSSSave, iconRSSDelete, iconRSSMinimize');
    }

    // ==================== Lifecycle ====================

    async onload() {
        // Must be called synchronously (before any await) per SiYuan API requirement
        this.boundHandleKeyboard = this.handleKeyboard.bind(this);
        this.registerCustomIcons();

        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            beforeDestroy: function () {
            },
            destroy: function () {
                // Clean up global event listeners when tab is closed
                document.removeEventListener('keydown', plugin.boundHandleKeyboard);
                if (plugin.resizerMoveHandler) {
                    document.removeEventListener('mousemove', plugin.resizerMoveHandler);
                    plugin.resizerMoveHandler = null;
                }
                if (plugin.resizerUpHandler) {
                    document.removeEventListener('mouseup', plugin.resizerUpHandler);
                    plugin.resizerUpHandler = null;
                }
                if (plugin.vResizerMoveHandler) {
                    document.removeEventListener('mousemove', plugin.vResizerMoveHandler);
                    plugin.vResizerMoveHandler = null;
                }
                if (plugin.vResizerUpHandler) {
                    document.removeEventListener('mouseup', plugin.vResizerUpHandler);
                    plugin.vResizerUpHandler = null;
                }
                plugin.isResizing = false;
                plugin.clearAllTimeouts();
                if (plugin.readStatusSaveTimer) {
                    clearTimeout(plugin.readStatusSaveTimer);
                    plugin.readStatusSaveTimer = null;
                }
                if (plugin.scrollThrottleTimer) {
                    clearTimeout(plugin.scrollThrottleTimer);
                    plugin.scrollThrottleTimer = null;
                }
                if (plugin.saveDebounceTimer) {
                    clearTimeout(plugin.saveDebounceTimer);
                    plugin.saveDebounceTimer = null;
                }
                if (plugin.container && plugin.listScrollHandler) {
                    const articleList = plugin.container.querySelector("#rssArticleList");
                    if (articleList) {
                        articleList.removeEventListener("scroll", plugin.listScrollHandler);
                    }
                }
                plugin.rssTab = null;
                plugin.rssTabOpen = false;
                plugin.container = null;
            },
            resize: function () {
                if (plugin.container && plugin.container.isConnected) {
                    const articleList = plugin.container.querySelector("#rssArticleList") as HTMLElement;
                    if (articleList && plugin.currentArticles.length > 0) {
                        plugin.checkAndLoadMore(plugin.container);
                    }
                }
            },
            init: function (this: any) {
                try {
                    const container = this.element as HTMLElement;
                    if (container) {
                        plugin.container = container;
                        plugin.initSidebarUI(container);
                    } else {
                        logger.error("[RSS] Tab container element is null");
                    }
                } catch (err) {
                    logger.error("[RSS] Tab init error:", err);
                }
            }
        });

        this.addCommand({
            langKey: "openRssReader",
            hotkey: "",
            callback: () => {
                plugin.openOrSwitchToRssTab();
            }
        });

        // Now safe to do async operations
        await this.loadSettings();
        
        this.detectLanguage();

        const data = await this.loadData(STORAGE_NAME);
        this.subscriptions = data || [];

        let migrated = false;
        this.subscriptions.forEach(sub => {
            if (sub.createdAt === undefined) {
                sub.createdAt = sub.lastFetchTime || Date.now();
                migrated = true;
            }
            if (sub.updatedAt === undefined) {
                sub.updatedAt = sub.lastFetchTime || Date.now();
                migrated = true;
            }
        });
        if (migrated) {
            logger.log("Migration: added createdAt/updatedAt to subscriptions");
            await this.saveData(STORAGE_NAME, this.subscriptions);
        }

        const before = this.subscriptions.length;
        this.subscriptions = this.subscriptions.filter(s => !s.url.includes("36kr.com"));
        if (this.subscriptions.length < before) {
            logger.log("Migration: removed 36kr from subscriptions");
            await this.saveData(STORAGE_NAME, this.subscriptions);
        }

        const status = await this.loadData(READ_STATUS_NAME);
        this.readStatus = status || {};

        await this.migrateCacheFormat();
        await this.cleanupCache();
        await this.cleanupReadStatus();

        // Pre-populate unread counts from cached data so badges are ready when tab opens
        const cachedArticles: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
        for (const subId of Object.keys(cachedArticles)) {
            const entry = cachedArticles[subId];
            if (entry?.articles) {
                const unread = entry.articles.filter((a: Article) =>
                    !(this.readStatus[a.id]?.isRead || a.isRead || false)
                ).length;
                this.unreadCounts.set(subId, unread);
            }
        }

        // Refresh UI if tab already opened before data was loaded
        if (this.container?.isConnected) {
            const rssList = this.container.querySelector("#rssList");
            if (rssList) {
                rssList.innerHTML = this.renderSubscriptionListHTML();
            }
            this.updateUnreadCounts();
        }

        this.setupAutoRefresh();
        this.checkForUpdates();
        this.cleanupInterval = setInterval(() => this.cleanupCache(), 24 * 60 * 60 * 1000);
        this.registerKeyboardShortcuts();
    }

    /**
     * Called when the layout is ready
     * SiYuan 3.3+ requires addDock() and addTopBar() to be called here
     */
    onLayoutReady() {
        const plugin = this;
        
        // Add top bar icon for opening RSS Reader in a tab
        this.addTopBar({
            icon: "iconRSSMain",
            title: this.i18n.rssReader || "RSS Reader",
            position: "right",
            callback: () => {
                plugin.openOrSwitchToRssTab();
            }
        });
    }

    /**
     * Open RSS Reader tab or switch to existing one if already open
     */
    private async openOrSwitchToRssTab(): Promise<void> {
        const rssTabTitle = this.i18n.rssReader || "RSS Reader";
        
        if (!this.app) {
            logger.error("[RSS] Plugin not initialized properly");
            showMessage(this.i18n.error || "插件未初始化", 3000);
            return;
        }
        
        // Check stored tab reference first (must be connected to DOM)
        if (this.rssTabOpen && this.rssTab) {
            const headEl = this.rssTab.headElement;
            if (headEl && headEl.isConnected) {
                try {
                    headEl.click();
                    logger.log("[RSS] Switched to existing tab");
                    return;
                } catch (err) {
                    logger.warn("[RSS] Stored tab no longer valid, opening new one");
                }
            } else {
                logger.log("[RSS] Stored tab was closed externally");
            }
            this.rssTab = null;
            this.rssTabOpen = false;
            // Fall through to open a new tab
        }
        
        // Fallback: check getOpenedTab for existing tabs
        const openedTabs = this.getOpenedTab();
        for (const key in openedTabs) {
            if (key.includes(TAB_TYPE)) {
                const customs = openedTabs[key];
                if (customs.length > 0 && customs[0].tab && customs[0].tab.headElement) {
                    this.rssTab = customs[0].tab;
                    this.rssTabOpen = true;
                    customs[0].tab.headElement.click();
                    logger.log("[RSS] Switched to existing tab via getOpenedTab");
                    return;
                }
            }
        }
        
        // Open new tab
        try {
            logger.log("[RSS] Opening new tab");
            const tab = await openTab({
                app: this.app,
                custom: {
                    id: "siyuan-rss-reader." + TAB_TYPE,
                    icon: "iconRSSMain",
                    title: rssTabTitle,
                },
                keepCursor: true,
            });
            this.rssTab = tab;
            this.rssTabOpen = true;

            // Direct content rendering (fallback if addTab init didn't fire)
            this.ensureTabContent(tab);
        } catch (err) {
            logger.error("[RSS] Failed to open tab:", err);
            showMessage(this.i18n.error || "打开标签页失败", 3000);
        }
    }

    /**
     * Ensure tab has content rendered. Called after openTab.
     * Works both as fallback if addTab init failed, and as primary renderer.
     */
    private ensureTabContent(tab: any): void {
        // Wait for DOM to settle
        requestAnimationFrame(() => {
            if (this.container && this.container.isConnected) return;

            // 1. Try via getOpenedTab (works if addTab was registered correctly)
            const openedTabs = this.getOpenedTab();
            for (const key in openedTabs) {
                if (key.includes(TAB_TYPE)) {
                    for (const custom of openedTabs[key]) {
                        if (custom?.element && custom.element.isConnected) {
                            this.container = custom.element as HTMLElement;
                            this.initSidebarUI(this.container);
                            return;
                        }
                    }
                }
            }

            // 2. Try via tab.model (Custom instance attached to the tab)
            const model = tab?.model as any;
            if (model?.element && model.element.isConnected) {
                this.container = model.element as HTMLElement;
                this.initSidebarUI(this.container);
                return;
            }

            // 3. Last resort: look for custom content container in the tab's panel
            const panel = tab?.panelElement as HTMLElement;
            if (panel) {
                const contentDiv = document.createElement("div");
                contentDiv.style.width = "100%";
                contentDiv.style.height = "100%";
                contentDiv.style.display = "flex";
                contentDiv.style.flexDirection = "column";
                panel.appendChild(contentDiv);
                this.container = contentDiv;
                this.initSidebarUI(contentDiv);
            }
        });
    }

    // Safe setTimeout that tracks all pending timeouts for cleanup
    private safeSetTimeout(fn: () => void, delay: number): NodeJS.Timeout {
        const timeout = setTimeout(() => {
            fn();
            // Remove from tracking array after execution
            this.pendingTimeouts = this.pendingTimeouts.filter(t => t !== timeout);
        }, delay);
        this.pendingTimeouts.push(timeout);
        return timeout;
    }

    // Clear all pending timeouts
    private clearAllTimeouts() {
        this.pendingTimeouts.forEach(t => clearTimeout(t));
        this.pendingTimeouts = [];
    }

    onunload() {
        // Clear all intervals
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Clear all pending timeouts
        this.clearAllTimeouts();
        
        // Clear debounce timer
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        
        // Clear scroll throttle timer
        if (this.scrollThrottleTimer) {
            clearTimeout(this.scrollThrottleTimer);
            this.scrollThrottleTimer = null;
        }
        
        // Flush pending read status changes before unload
        if (this.pendingReadStatusChanges.size > 0) {
            logger.log(`[Unload] Flushing ${this.pendingReadStatusChanges.size} pending read status changes`);
            if (this.readStatusSaveTimer) {
                clearTimeout(this.readStatusSaveTimer);
            }
            // Synchronously apply changes to avoid data loss
            for (const [articleId, status] of this.pendingReadStatusChanges.entries()) {
                this.readStatus[articleId] = status;
            }
            this.pendingReadStatusChanges.clear();
            // Fire-and-forget save: persist read status before unload
            this.saveData(READ_STATUS_NAME, this.readStatus).catch(err =>
                logger.error("[Unload] Failed to save read status:", err)
            );
        }
        
        // Cancel all pending network requests
        this.pendingRequests.clear();
        
        // Log performance metrics in debug mode
        if (DEBUG) {
            logger.log("[Perf Summary]", {
                fetches: this.perfMetrics.fetchCount,
                avgFetchTime: this.perfMetrics.fetchCount > 0 ? 
                    `${(this.perfMetrics.totalFetchTime / this.perfMetrics.fetchCount).toFixed(0)}ms` : 'N/A',
                cacheHits: this.perfMetrics.cacheHitCount,
                renders: this.perfMetrics.renderCount,
                avgRenderTime: this.perfMetrics.renderCount > 0 ? 
                    `${(this.perfMetrics.totalRenderTime / this.perfMetrics.renderCount).toFixed(0)}ms` : 'N/A'
            });
        }
        
        // Remove keyboard event listener
        document.removeEventListener('keydown', this.boundHandleKeyboard);
        
        // Cleanup global resizer event listeners
        if (this.resizerMoveHandler) document.removeEventListener('mousemove', this.resizerMoveHandler);
        if (this.resizerUpHandler) document.removeEventListener('mouseup', this.resizerUpHandler);
        if (this.vResizerMoveHandler) document.removeEventListener('mousemove', this.vResizerMoveHandler);
        if (this.vResizerUpHandler) document.removeEventListener('mouseup', this.vResizerUpHandler);

        // Cleanup subscription event listener
        if (this.subscriptionEventAbort) {
            this.subscriptionEventAbort.abort();
            this.subscriptionEventAbort = null;
        }
        
        // Cleanup scroll handler
        if (this.container) {
            const articleList = this.container.querySelector("#rssArticleList");
            if (articleList && this.listScrollHandler) {
                articleList.removeEventListener("scroll", this.listScrollHandler);
            }
        }
        
        // Close all RSS Reader tabs when plugin is unloaded
        this.closeAllRssTabs();
    }

    /**
     * Close all open RSS Reader tabs
     */
    private closeAllRssTabs(): void {
        if (this.rssTab) {
            try {
                this.rssTab.close();
            } catch (err) {
                logger.error("[RSS] Failed to close stored tab:", err);
            }
            this.rssTab = null;
            this.rssTabOpen = false;
        }
        
        const openedTabs = this.getOpenedTab();
        for (const key in openedTabs) {
            if (key.includes(TAB_TYPE)) {
                for (const custom of openedTabs[key]) {
                    try {
                        if (custom.tab) {
                            custom.tab.close();
                            this.rssTabOpen = false;
                        }
                    } catch (err) {
                        logger.error("[RSS] Failed to close tab:", err);
                    }
                }
            }
        }
    }

    /**
     * Called when plugin is completely uninstalled from marketplace
     * Clean up all saved data to prevent残留
     */
    async uninstall() {
        logger.log("Uninstalling RSS Reader plugin, cleaning up data...");
        
        // Remove all plugin data (subscriptions, read status, cached articles, settings)
        await this.removeData(STORAGE_NAME);      // rss_subscriptions
        await this.removeData(READ_STATUS_NAME);  // rss_read_status
        await this.removeData(CACHED_ARTICLES_NAME); // rss_cached_articles
        await this.removeData(SETTINGS_NAME);     // rss_settings
        
        logger.log("RSS Reader plugin data cleaned up successfully");
    }

    private async loadSettings() {
        const saved = await this.loadData(SETTINGS_NAME);
        if (saved) {
            this.settings = { ...defaultSettings, ...saved };
            // Migrate old nested layout format to simple string
            if (typeof this.settings.layout === 'object' && this.settings.layout !== null) {
                const old = this.settings.layout as any;
                this.settings.layout = old.currentMode === 'horizontal' ? 'horizontal' : 'vertical';
            }
            // Migrate old fontSize enum to numeric
            if (typeof this.settings.fontSize === 'string') {
                const map: Record<string, number> = { 'small': 12, 'medium': 14, 'large': 16 };
                this.settings.fontSize = map[this.settings.fontSize] || 14;
            }
        } else {
            this.settings = { ...defaultSettings };
        }
    }

    // Fix #3: Detect SiYuan language and set locale
    private detectLanguage() {
        try {
            // @ts-ignore
            const lang = window.siyuan?.config?.lang || "en";
            // SiYuan's i18n is handled by the plugin system based on lang
            // We don't need to manually switch - it's automatic
            logger.log("Detected language:", lang);
        } catch (e) {
            logger.warn("Failed to detect language:", e);
        }
    }

    // ==================== Settings ====================

    private async saveSettings() {
        try {
            await this.saveData(SETTINGS_NAME, this.settings);
        } catch (error) {
            logger.error("Failed to save settings:", error);
            showMessage(this.i18n.saveFailed || "Save failed", 3000);
        }
    }

    private registerKeyboardShortcuts() {
        if (!this.settings.enableKeyboardShortcuts) return;
        // Prevent duplicate event listeners
        document.removeEventListener('keydown', this.boundHandleKeyboard);
        document.addEventListener('keydown', this.boundHandleKeyboard);
    }

    private handleKeyboard(e: KeyboardEvent) {
        if (!this.container || !this.settings.enableKeyboardShortcuts) return;
        
        const target = e.target as HTMLElement;
        
        // ========== 混合方案：智能判断 ==========
        
        // 1. 排除标准输入元素
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
            return;
        }
        
        // 2. 排除思源笔记编辑器区域（方案一）- 这是最重要的判断
        if (target.closest('.protyle-wysiwyg')) {
            return;
        }
        
        // 3. 排除代码块区域
        if (target.closest('.code-block') || target.closest('pre')) {
            return;
        }
        
        // 4. 排除可编辑区域
        if (target.isContentEditable || target.parentElement?.isContentEditable) {
            return;
        }
        
        // 5. 检查面板是否可见（使用更可靠的检测方法）
        const isPanelVisible = this.isRssTabVisible();
        
        // 6. 检查焦点是否在面板内
        const isInPanel = this.container.contains(target);
        
        // 简化逻辑：只要面板可见或者焦点在面板内，就响应快捷键（已经排除了编辑器区域）
        if (!isPanelVisible && !isInPanel) {
            return;
        }

        switch (e.key.toLowerCase()) {
            case SHORTCUTS.NEXT_ARTICLE: e.preventDefault(); this.navigateArticle(1); break;
            case SHORTCUTS.PREV_ARTICLE: e.preventDefault(); this.navigateArticle(-1); break;
            case SHORTCUTS.OPEN_ORIGINAL: e.preventDefault(); this.openCurrentArticleOriginal(); break;
            case SHORTCUTS.SAVE_TO_SIYUAN: e.preventDefault(); this.saveCurrentArticle(); break;
            case SHORTCUTS.REFRESH: e.preventDefault(); if (this.container) this.refreshCurrentFeed(this.container); break;
            case SHORTCUTS.MARK_ALL_READ: e.preventDefault(); if (this.container) this.markAllRead(this.container); break;
            case SHORTCUTS.HELP: e.preventDefault(); this.showHelpDialog(); break;
            case SHORTCUTS.PAGE_DOWN: e.preventDefault(); this.scrollArticleContentPage(); break;
        }
    }
    
    /**
     * 检测 RSS Reader 标签页是否可见
     * 使用多种方法确保准确性
     */
    private isRssTabVisible(): boolean {
        // 方法1：检查容器元素是否存在
        if (!this.container) return false;
        
        // 方法2：检查容器是否可见
        const containerStyle = window.getComputedStyle(this.container);
        if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') {
            return false;
        }
        
        // 方法3：检查容器的父元素链是否有隐藏的
        let parent = this.container.parentElement;
        while (parent) {
            const parentStyle = window.getComputedStyle(parent);
            if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') {
                return false;
            }
            parent = parent.parentElement;
        }
        
        return true;
    }

    // Get font size CSS value based on numeric fontSize setting (12-20px)
    private getFontSizeStyle(): FontSizeConfig {
        const base = Math.max(12, Math.min(20, this.settings.fontSize || 14));
        return {
            content: `${base}px`,
            title: `${base + 2}px`,
            meta: `${base - 3}px`,
            listItem: `${base - 1}px`,
            listDesc: `${base - 3}px`,
            listDate: `${base - 4}px`,
            sliderLabel: `${base}px`
        };
    }

    private navigateArticle(direction: number) {
        if (this.currentArticles.length === 0) return;
        let newIndex = this.currentArticleIndex + direction;
        if (newIndex < 0) newIndex = this.currentArticles.length - 1;
        else if (newIndex >= this.currentArticles.length) newIndex = 0;
        this.currentArticleIndex = newIndex;
        if (this.container) {
            this.selectArticle(newIndex, this.container);
            this.scrollToArticle(newIndex);
        }
    }

    private scrollToArticle(index: number) {
        if (!this.container) return;
        const el = this.container.querySelector(`.article-item[data-index="${index}"]`) as HTMLElement;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    private openCurrentArticleOriginal() {
        if (this.currentArticleIndex < 0) return;
        const article = this.currentArticles[this.currentArticleIndex];
        if (article?.link) window.open(article.link, '_blank');
    }

    private saveCurrentArticle() {
        if (this.currentArticleIndex < 0) return;
        const article = this.currentArticles[this.currentArticleIndex];
        if (article) this.saveArticleToSiYuan(article);
    }

    private scrollArticleContentPage() {
        if (!this.container) return;
        const content = this.container.querySelector("#rssArticleContent") as HTMLElement;
        if (content) {
            content.scrollBy({ top: content.clientHeight * 0.9, behavior: 'smooth' });
        }
    }

    // ==================== UI ====================

    private initSidebarUI(container: HTMLElement, force = false) {
        // Guard: prevent double render (e.g. addTab.init + ensureTabContent both firing)
        // Use force=true to skip guard when rebuilding layout (e.g. after settings change)
        if (!force && container.querySelector('.rss-reader-container')) return;

        // Reset event binding flag before rebuilding DOM
        this.subscriptionEventsBound = false;
        
        // CRITICAL: Clean up ALL resizer event listeners BEFORE destroying DOM
        // This prevents stale listeners from accessing destroyed elements
        if (this.resizerMoveHandler) {
            document.removeEventListener('mousemove', this.resizerMoveHandler);
            this.resizerMoveHandler = null;
        }
        if (this.resizerUpHandler) {
            document.removeEventListener('mouseup', this.resizerUpHandler);
            this.resizerUpHandler = null;
        }
        if (this.vResizerMoveHandler) {
            document.removeEventListener('mousemove', this.vResizerMoveHandler);
            this.vResizerMoveHandler = null;
        }
        if (this.vResizerUpHandler) {
            document.removeEventListener('mouseup', this.vResizerUpHandler);
            this.vResizerUpHandler = null;
        }
        // Reset resizing flag

        // Load unread counts BEFORE rendering so badges appear immediately
        this.isResizing = false;
        
        const isH = this.settings.layout === 'vertical';
        const listFlex = isH ? '0 0 35%' : '0 0 40%';
        const listBorder = isH ? 'border-right:1px solid var(--b3-border-color)' : 'border-bottom:1px solid var(--b3-border-color)';
        const listMin = isH ? 'min-width:120px' : 'min-height:80px';
        const resizerStyle = isH ? 'width:4px;cursor:col-resize' : 'height:4px;cursor:row-resize';
        const contentDir = isH ? 'row' : 'column';

        container.innerHTML = `
            <div class="rss-reader-container" style="width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative;">
                <div style="flex:1;display:flex;overflow:hidden;">
                    <!-- Left: subscription sidebar -->
                    <div id="rssSidebar" class="rss-sidebar" style="width:20%;min-width:min-content;max-width:35%;border-right:1px solid var(--b3-border-color);display:flex;flex-direction:column;background:var(--b3-theme-surface);flex-shrink:0;">
                        <!-- Subscription list (includes add button) -->
                        <div id="rssList" class="rss-list" style="flex:1;overflow-y:auto;padding:4px;">
                            ${this.renderSubscriptionListHTML()}
                        </div>
                        <!-- Article count bar -->
                        <div id="articleCount" style="padding:4px 10px;font-size:11px;color:var(--b3-font-color-quaternary);text-align:center;border-top:1px solid var(--b3-border-color);flex-shrink:0;"></div>
                        <!-- Bottom bar: Settings + Help with slide animation -->
                        <div class="rss-bottom-bar">
                            <button id="tbSettings" title="${this.i18n.settings}" class="rss-bottom-btn tb-settings">
                                <span class="rss-bottom-btn-icon"><svg><use xlink:href="#iconRSSSettings"></use></svg></span>
                                <span class="rss-bottom-btn-text">${this.i18n.settings}</span>
                            </button>
                            <button id="tbHelp" title="${this.i18n.help}" class="rss-bottom-btn tb-help">
                                <span class="rss-bottom-btn-icon"><svg><use xlink:href="#iconRSSHelp"></use></svg></span>
                                <span class="rss-bottom-btn-text">${this.i18n.help}</span>
                            </button>
                        </div>
                    </div>
                    <!-- Horizontal resizer -->
                    <div id="rssResizer" style="width:4px;background:var(--b3-border-color);cursor:col-resize;flex-shrink:0;"></div>
                    <!-- Right: article list + content (id=rssContentArea for layout switching) -->
                    <div id="rssContentArea" style="flex:1;display:flex;flex-direction:${contentDir};overflow:hidden;min-width:0;">
                        <div id="rssArticleList" style="flex:${listFlex};${listMin};${listBorder};overflow-y:auto;background:var(--b3-theme-background);">
                            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">
                                ${this.i18n.selectArticle}
                            </div>
                        </div>
                        <div id="rssVerticalResizer" style="${resizerStyle};background:var(--b3-border-color);flex-shrink:0;"></div>
                        <div id="rssArticleContent" style="flex:1;overflow-y:auto;background:var(--b3-theme-background);">
                            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">
                                ${this.i18n.selectArticle}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

        this.setupEventListeners(container);
        this.setupInfiniteScroll(container);
        
        this.updateUnreadCounts().then(() => {
            const rssList = container.querySelector("#rssList");
            if (rssList) {
                rssList.innerHTML = this.renderSubscriptionListHTML();
            }
        });
    }

    private setupEventListeners(container: HTMLElement) {
        const bind = (id: string, fn: () => void) => {
            container.querySelector('#' + id)?.addEventListener('click', fn);
        };
        bind('tbSettings', () => this.showSettingsDialog(container));
        bind('tbHelp', () => this.showHelpDialog());

        // SiYuan built-in block__icon class handles hover styles automatically

        this.setupSubscriptionEvents(container);
        this.setupResizerEvents(container);
    }

    private renderSubscriptionListHTML(): string {
        let html = '';
        
        if (this.subscriptions.length === 0) {
            // When empty: show enhanced "+" button with slide animation, then empty state message
            html += `<div style="padding:8px;display:flex;justify-content:center;">
                <button id="tbAdd" title="${this.i18n.add}" class="rss-add-btn-enhanced">
                    <span class="rss-add-btn-sign">
                        <svg style="width:16px;height:16px;"><use xlink:href="#iconRSSAdd"></use></svg>
                    </span>
                    <span class="rss-add-btn-text">${this.i18n.add || 'Add'}</span>
                </button>
            </div>`;
            html += `<div style="padding:16px;color:var(--b3-font-color-quaternary);text-align:center;font-size:12px;">
                <div style="font-size:24px;margin-bottom:8px;opacity:0.6;"><svg class="block__logoicon" style="width:28px;height:28px;"><use xlink:href="#iconRSSMain"></use></svg></div>
                <div>${this.i18n.noSubscriptions}</div>
                <div style="margin-top:4px;font-size:11px;">${this.i18n.addFirst}</div>
            </div>`;
        } else {
            // When populated: show subscription items first, then "+" button at bottom
            const fs = this.getFontSizeStyle();
            html += this.subscriptions.map((sub, index) => `
                <div class="rss-item ${this.currentSubscriptionIndex === index ? 'active' : ''}"
                    data-index="${index}"
                    style="padding:8px 10px;border-radius:4px;margin-bottom:4px;cursor:pointer;display:flex;align-items:center;gap:8px;">
                    <!-- Left border indicator (fixed width placeholder) -->
                    <div style="width:3px;flex-shrink:0;"></div>
                    <!-- Subscription name (clickable) -->
                    <div class="subscription-name" data-index="${index}" style="flex:1;min-width:0;padding:2px 4px;position:relative;">
                        <div style="font-size:${fs.listItem};font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--b3-font-color);">
                            ${sub.name || sub.url}
                        </div>
                        ${(this.unreadCounts.get(sub.id) ?? 0) > 0 ? `<span class="unread-badge">${this.formatUnreadCount(this.unreadCounts.get(sub.id)!)}</span>` : ''}
                    </div>
                    <!-- Action buttons: Mark Read, Refresh, Delete -->
                    <div class="subscription-actions">
                        <button class="mark-read-rss rss-action-btn-enhanced" data-index="${index}" title="${this.i18n.markAllRead}">
                            <span class="rss-action-btn-sign">
                                <svg><use xlink:href="#iconRSSCheck"></use></svg>
                            </span>
                            <span class="rss-action-btn-text">${this.i18n.markAllRead || 'Mark Read'}</span>
                        </button>
                        <button class="refresh-rss rss-action-btn-enhanced" data-index="${index}" title="${this.i18n.refresh}">
                            <span class="rss-action-btn-sign">
                                <svg><use xlink:href="#iconRSSRefresh"></use></svg>
                            </span>
                            <span class="rss-action-btn-text">${this.i18n.refresh || 'Refresh'}</span>
                        </button>
                        <button class="delete-rss rss-action-btn-enhanced" data-index="${index}" title="${this.i18n.delete}">
                            <span class="rss-action-btn-sign">
                                <svg><use xlink:href="#iconRSSDelete"></use></svg>
                            </span>
                            <span class="rss-action-btn-text">${this.i18n.delete || 'Delete'}</span>
                        </button>
                    </div>
                </div>
            `).join("");
            
            // Add button at bottom of subscription list
            html += `<div style="padding:8px;display:flex;justify-content:center;">
                <button id="tbAdd" title="${this.i18n.add}" class="rss-add-btn-enhanced">
                    <span class="rss-add-btn-sign">
                        <svg style="width:16px;height:16px;"><use xlink:href="#iconRSSAdd"></use></svg>
                    </span>
                    <span class="rss-add-btn-text">${this.i18n.add || 'Add'}</span>
                </button>
            </div>`;
        }
        
        return html;
    }

    private subscriptionEventAbort: AbortController | null = null;

    private setupSubscriptionEvents(container: HTMLElement) {
        // Always clean up previous handler to prevent duplicate bindings
        if (this.subscriptionEventAbort) {
            this.subscriptionEventAbort.abort();
        }
        this.subscriptionEventAbort = new AbortController();
        const signal = this.subscriptionEventAbort.signal;

        container.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            const rssList = container.querySelector("#rssList");
            if (!rssList || !rssList.contains(target)) {
                return;
            }

            const addBtn = target.closest("#tbAdd");
            if (addBtn) {
                e.stopPropagation();
                this.showAddSubscriptionDialog(container);
                return;
            }

            const deleteBtn = target.closest(".delete-rss");
            if (deleteBtn) {
                e.stopPropagation();
                const index = parseInt((deleteBtn as HTMLElement).dataset.index!);
                this.deleteSubscription(index, container);
                return;
            }

            const refreshBtn = target.closest(".refresh-rss");
            if (refreshBtn) {
                e.stopPropagation();
                const index = parseInt((refreshBtn as HTMLElement).dataset.index!);
                this.refreshSubscription(index, container);
                return;
            }

            const markReadBtn = target.closest(".mark-read-rss");
            if (markReadBtn) {
                e.stopPropagation();
                const index = parseInt((markReadBtn as HTMLElement).dataset.index!);
                this.markSubscriptionRead(index, container);
                return;
            }

            const nameArea = target.closest(".subscription-name");
            if (nameArea) {
                const index = parseInt((nameArea as HTMLElement).dataset.index!);
                this.selectSubscription(index, container);
            }
        }, { signal });

        this.subscriptionEventsBound = true;
    }

    // ==================== Resizer ====================

    private setupResizerEvents(container: HTMLElement) {
        // Fix #3: Clean up old event listeners before adding new ones
        if (this.resizerMoveHandler) document.removeEventListener('mousemove', this.resizerMoveHandler);
        if (this.resizerUpHandler) document.removeEventListener('mouseup', this.resizerUpHandler);
        if (this.vResizerMoveHandler) document.removeEventListener('mousemove', this.vResizerMoveHandler);
        if (this.vResizerUpHandler) document.removeEventListener('mouseup', this.vResizerUpHandler);
        
        const hResizer = container.querySelector("#rssResizer") as HTMLElement;
        const vResizer = container.querySelector("#rssVerticalResizer") as HTMLElement;
        const sidebar = container.querySelector("#rssSidebar") as HTMLElement;
        const articleList = container.querySelector("#rssArticleList") as HTMLElement;

        if (hResizer && sidebar) {
            let startX = 0, startWidth = 0, resizing = false;

            hResizer.addEventListener("mousedown", (e) => {
                e.preventDefault();
                resizing = true;
                this.isResizing = true;
                startX = e.clientX;
                // Re-query element on each drag to avoid stale references
                const currentSidebar = container.querySelector("#rssSidebar") as HTMLElement;
                if (!currentSidebar) return;
                startWidth = currentSidebar.offsetWidth;
                hResizer.style.background = "var(--b3-theme-primary)";
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
            });

            const onMove = (e: MouseEvent) => {
                if (!resizing || this.isResizing === false) return;
                // Re-query element on each move to avoid null references
                const currentSidebar = container.querySelector("#rssSidebar") as HTMLElement;
                if (!currentSidebar || !currentSidebar.parentElement) return;
                const parent = currentSidebar.parentElement;
                try {
                    const pct = ((startWidth + e.clientX - startX) / parent.offsetWidth) * 100;
                    if (pct >= 10 && pct <= 35) currentSidebar.style.width = `${pct}%`;
                } catch (err) {
                    // Silently fail if parent is null/invalid
                    resizing = false;
                }
            };

            const onUp = () => {
                if (!resizing) return;
                resizing = false;
                // Delay resetting isResizing so ResizeObserver doesn't fire during drag release
                this.safeSetTimeout(() => { this.isResizing = false; }, 300);
                hResizer.style.background = "";
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                this.saveSettings();
            };

            this.resizerMoveHandler = onMove;
            this.resizerUpHandler = onUp;
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        }

        if (vResizer && articleList) {
            let startY = 0, startX = 0, startPct = 0, resizing = false;

            vResizer.addEventListener("mousedown", (e) => {
                e.preventDefault();
                resizing = true;
                this.isResizing = true;
                // Re-query element on each drag
                const currentArticleList = container.querySelector("#rssArticleList") as HTMLElement;
                if (!currentArticleList) return;
                const parent = currentArticleList.parentElement;
                if (!parent) return;
                if (this.settings.layout === 'vertical') {
                    startX = e.clientX;
                    startPct = (currentArticleList.offsetWidth / parent.offsetWidth) * 100;
                } else {
                    startY = e.clientY;
                    startPct = (currentArticleList.offsetHeight / parent.offsetHeight) * 100;
                }
                vResizer.style.background = "var(--b3-theme-primary)";
                const cursor = this.settings.layout === 'vertical' ? 'col-resize' : 'row-resize';
                document.body.style.cursor = cursor;
                document.body.style.userSelect = "none";
            });

            const onMove = (e: MouseEvent) => {
                if (!resizing || this.isResizing === false) return;
                // Re-query element on each move
                const currentArticleList = container.querySelector("#rssArticleList") as HTMLElement;
                if (!currentArticleList || !currentArticleList.parentElement) return;
                const parent = currentArticleList.parentElement;
                try {
                    if (this.settings.layout === 'vertical') {
                        const delta = e.clientX - startX;
                        const newPct = startPct + (delta / parent.offsetWidth) * 100;
                        if (newPct >= 10 && newPct <= 80) currentArticleList.style.flexBasis = `${newPct}%`;
                    } else {
                        const delta = e.clientY - startY;
                        const newPct = startPct + (delta / parent.offsetHeight) * 100;
                        if (newPct >= 10 && newPct <= 80) currentArticleList.style.flexBasis = `${newPct}%`;
                    }
                } catch (err) {
                    // Silently fail if parent is null/invalid
                    resizing = false;
                }
            };

            const onUp = () => {
                if (!resizing) return;
                resizing = false;
                this.safeSetTimeout(() => { this.isResizing = false; }, 300);
                vResizer.style.background = "";
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                this.saveSettings();
            };

            this.vResizerMoveHandler = onMove;
            this.vResizerUpHandler = onUp;
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        }
    }

    // ==================== Subscription Management ====================

    private async selectSubscription(index: number, container: HTMLElement, forceReload: boolean = false) {
        // Prevent reloading if already selected (unless forceReload is true)
        if (this.currentSubscriptionIndex === index && !forceReload) {
            logger.log("Subscription already selected, skipping reload");
            return;
        }
        
        this.currentSubscriptionIndex = index;
        this.displayedArticleCount = 0;
        this.currentArticles = [];
        this.currentArticleIndex = -1; // Clear selected article index
        this.autoLoadRetryCount = 0; // Reset auto-load retry counter when switching subscriptions

        // Clear article content window when switching subscriptions
        const contentEl = container.querySelector("#rssArticleContent") as HTMLElement;
        if (contentEl) {
            contentEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">${this.i18n.selectArticle || 'Select an article to read'}</div>`;
        }

        const sub = this.subscriptions[index];
        const articleListEl = container.querySelector("#rssArticleList") as HTMLElement;
        const countEl = container.querySelector("#articleCount") as HTMLElement;

        container.querySelectorAll(".rss-item").forEach((item) => {
            const i = parseInt((item as HTMLElement).dataset.index!);
            item.classList.toggle("active", i === index);
            // Removed inline styles - let CSS handle active state
        });

        articleListEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--b3-font-color-quaternary);font-size:13px;">
            <div class="fn__loading" style="margin:0 auto;"></div>
            <div style="margin-top:8px;">${this.i18n.loading}</div>
        </div>`;

        try {
            // Fix #1: Use cache-first strategy to reduce latency
            const cached = await this.getCachedArticles(sub.id);
            
            // If we have recent cache (< 5 minutes), show it immediately
            const now = Date.now();
            const hasRecentCache = cached.length > 0 && cached[0].cachedAt && (now - cached[0].cachedAt < 5 * 60 * 1000);
            
            if (hasRecentCache) {
                // Track cache hit
                this.perfMetrics.cacheHitCount++;
                
                // Show cached articles immediately for better UX
                this.currentArticles = cached;
                this.displayedArticleCount = 0;
                if (countEl) {
                    const unread = cached.filter(a => !a.isRead).length;
                    countEl.textContent = unread > 0 ? `${unread}/${cached.length}` : `${cached.length}`;
                }
                // Update unread badge
                const cachedUnread = cached.filter((a: Article) => !a.isRead).length;
                this.unreadCounts.set(sub.id, cachedUnread);
                const listEl = container.querySelector("#rssList");
                if (listEl) {
                    listEl.innerHTML = this.renderSubscriptionListHTML();
                }
                this.renderArticleList(container);
                this.safeSetTimeout(() => this.checkAndLoadMore(container), 100);
                
                // Smart background refresh: only fetch if cache is old or user explicitly requests
                const lastFetch = this.lastBackgroundFetchTime.get(sub.id) || 0;
                const cacheAge = Date.now() - lastFetch;
                
                // Only auto-refresh if cache is older than 5 minutes AND no pending request
                if (cacheAge > this.CACHE_EXPIRY_MS && !this.pendingRequests.has(sub.id)) {
                    this.fetchAndCacheArticles(sub).then(articles => {
                        this.lastBackgroundFetchTime.set(sub.id, Date.now());
                        // Always update unread badge regardless of current selection
                        const unread = articles.filter((a: Article) => !(this.readStatus[a.id]?.isRead || a.isRead || false)).length;
                        this.unreadCounts.set(sub.id, unread);
                        const listEl = container.querySelector("#rssList");
                        if (listEl) {
                            listEl.innerHTML = this.renderSubscriptionListHTML();
                        }
                        // Only update article list if user hasn't switched to another subscription
                        if (this.currentSubscriptionIndex === index) {
                            this.currentArticles = articles;
                            this.displayedArticleCount = 0;
                            if (countEl) {
                                countEl.textContent = unread > 0 ? `${unread}/${articles.length}` : `${articles.length}`;
                            }
                            this.renderArticleList(container);
                            this.safeSetTimeout(() => this.checkAndLoadMore(container), 100);
                        }
                    }).catch(err => {
                        logger.warn("Background fetch failed:", err);
                    });
                }
            } else {
                // No cache, fetch fresh data
                const articles = await this.fetchAndCacheArticles(sub);
                this.currentArticles = articles;
                this.displayedArticleCount = 0;
                if (countEl) {
                    const unread = articles.filter(a => !a.isRead).length;
                    countEl.textContent = unread > 0 ? `${unread}/${articles.length}` : `${articles.length}`;
                }
                // Update unread badge
                const freshUnread = articles.filter((a: Article) => !a.isRead).length;
                this.unreadCounts.set(sub.id, freshUnread);
                const listEl = container.querySelector("#rssList");
                if (listEl) {
                    listEl.innerHTML = this.renderSubscriptionListHTML();
                }
                this.renderArticleList(container);
                // Fix #5: Auto-load more if list doesn't fill the container
                this.safeSetTimeout(() => this.checkAndLoadMore(container), 100);
            }
        } catch (error) {
            logger.error("Failed to fetch RSS:", error);
            articleListEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--b3-theme-error);font-size:13px;">
               ${this.i18n.networkError}
            </div>`;
        }
    }

    /**
     * Timestamp-based merge for multi-device sync
     * Strategy: 
     * - DELETED always wins (if any device deleted, stay deleted)
     * - Otherwise keep the version with latest updatedAt
     * - Local changes (add/update) always preserved
     * Leverages SiYuan's built-in sync mechanism
     */
    private async saveSubscriptionsWithMerge(): Promise<void> {
        try {
            const existing: Subscription[] = await this.loadData(STORAGE_NAME) || [];
            const mergedMap = new Map<string, Subscription>();

            // First, add all existing subscriptions to track what's in storage
            existing.forEach((sub: Subscription) => {
                if (sub.id) mergedMap.set(sub.id, sub);
            });

            // Then process current subscriptions
            this.subscriptions.forEach((sub: Subscription) => {
                if (!sub.id) return;
                
                // If current subscription is deleted, remove from merged result
                if (sub.deleted) {
                    mergedMap.delete(sub.id);
                    return;
                }
                
                // If not in storage yet, always add
                const existingSub = mergedMap.get(sub.id);
                if (!existingSub) {
                    mergedMap.set(sub.id, sub);
                    return;
                }
                
                // If in storage and is deleted there, replace with new non-deleted one
                // This allows re-adding a subscription that was previously deleted
                if (existingSub.deleted) {
                    mergedMap.set(sub.id, sub);
                    return;
                }
                
                // Both exist and neither is deleted - keep the newer version
                if (sub.updatedAt > (existingSub.updatedAt || 0)) {
                    mergedMap.set(sub.id, sub);
                }
            });

            const merged = Array.from(mergedMap.values());
            await this.saveData(STORAGE_NAME, merged);
            this.subscriptions = merged;
            logger.log(`Subscriptions merged: ${existing.length} existing + ${this.subscriptions.length} local = ${merged.length} total`);
        } catch (error) {
            logger.error("Failed to save subscriptions:", error);
        }
    }

    private async deleteSubscription(index: number, container: HTMLElement) {
        const sub = this.subscriptions[index];

        const confirmed = await new Promise<boolean>((resolve) => {
            const dialog = new Dialog({
                title: this.i18n.deleteConfirm,
                content: `<div class="b3-dialog__content" style="padding:16px;">
                    <div style="color:var(--b3-font-color);font-size:14px;">${sub.name || sub.url}</div>
                </div>
                <div class="b3-dialog__action">
                    <button type="button" class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                    <div class="fn__space"></div>
                    <button type="button" class="b3-button b3-button--text" id="delConfirm" style="color:var(--b3-theme-error);">${this.i18n.delete}</button>
                </div>`,
                width: "350px",
            });
            //Fix z-index to be above sticky header
            requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });
            
            const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement;
            const confirmBtn = dialog.element.querySelector("#delConfirm") as HTMLButtonElement;
            
            // Use onclick instead of addEventListener to override any default handlers
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    dialog.destroy();
                    resolve(false);
                };
            }
            
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    // Destroy dialog synchronously first
                    dialog.destroy();
                    // Resolve immediately - don't delay
                    resolve(true);
                };
            }
        });

        if (!confirmed) return;

        // Mark subscription as deleted (soft delete for sync)
        sub.deleted = true;
        sub.updatedAt = Date.now();

        // Clean up cached articles for this subscription
        if (sub.id) {
            try {
                const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
                delete cached[sub.id];
                await this.saveData(CACHED_ARTICLES_NAME, cached);
            } catch (error) {
                logger.error("Failed to delete cached articles:", error);
            }
            this.unreadCounts.delete(sub.id);
        }

        // Save current selection ID before merge
        const selectedSubId = this.currentSubscriptionIndex >= 0 && this.currentSubscriptionIndex < this.subscriptions.length
            ? this.subscriptions[this.currentSubscriptionIndex].id
            : null;

        // Save with soft delete and sync
        await this.saveSubscriptionsWithMerge();

        // Re-locate selection by ID to handle index shifting
        if (selectedSubId) {
            const newIndex = this.subscriptions.findIndex(s => s.id === selectedSubId);
            if (newIndex >= 0) {
                this.currentSubscriptionIndex = newIndex;
            } else {
                // Current subscription was deleted, reset selection
                this.currentSubscriptionIndex = -1;
                this.currentArticles = [];
                this.currentArticleIndex = -1;
                const articleListEl = container.querySelector("#rssArticleList") as HTMLElement;
                articleListEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">${this.i18n.selectArticle}</div>`;
                const contentEl = container.querySelector("#rssArticleContent") as HTMLElement;
                contentEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">${this.i18n.selectArticle}</div>`;
                const countEl = container.querySelector("#articleCount") as HTMLElement;
                if (countEl) countEl.textContent = "";
            }
        }

        container.querySelector("#rssList")!.innerHTML = this.renderSubscriptionListHTML();
        showMessage(this.i18n.deleteSuccess, 2000);
    }

    private showAddSubscriptionDialog(container: HTMLElement) {
        const dialog = new Dialog({
            title: this.i18n.add,
            content: `<div class="b3-dialog__content">
                <div class="b3-label">
                    <div style="margin-bottom:8px;font-size:13px;font-weight:500;">${this.i18n.featuredFeeds}</div>
                    <select class="b3-select fn__block" id="featuredFeeds" style="margin-bottom:12px;">
                        <option value="">${this.i18n.selectFeed}</option>
                        ${FEATURED_FEEDS.map(f => `<option value="${f.name}|${f.url}">${f.name}</option>`).join("")}
                    </select>
                </div>
                <div style="text-align:center;color:var(--b3-font-color-quaternary);margin:12px 0;font-size:12px;">${this.i18n.or}</div>
                <div class="b3-label">
                    <div style="margin-bottom:8px;font-size:13px;font-weight:500;">${this.i18n.enterManually}</div>
                    <input class="b3-text-field fn__block" id="rssUrl" placeholder="${this.i18n.feedUrl}" style="margin-bottom:6px;font-size:13px;">
                    <input class="b3-text-field fn__block" id="rssName" placeholder="${this.i18n.feedName}" style="font-size:13px;">
                </div>
            </div>
            <div class="b3-dialog__action">
                <button type="button" class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                <div class="fn__space"></div>
                <button type="button" class="b3-button b3-button--text" id="confirmAdd">${this.i18n.confirm}</button>
            </div>`,
            width: "400px",
        });

        //Fix #4: Ensure dialog is above article content sticky header
        requestAnimationFrame(() => {
            const el = dialog.element;
            if (el) {
                el.style.zIndex = "9999";
                const content = el.querySelector(".b3-dialog__content");
                if (content) (content as HTMLElement).style.position = "relative";
            }
        });

        const urlInput = dialog.element.querySelector("#rssUrl") as HTMLInputElement;
        const nameInput = dialog.element.querySelector("#rssName") as HTMLInputElement;
        const featuredSelect = dialog.element.querySelector("#featuredFeeds") as HTMLSelectElement;
        const confirmBtn = dialog.element.querySelector("#confirmAdd") as HTMLButtonElement;

        // Add real-time URL validation feedback
        urlInput.addEventListener('input', () => {
            const url = urlInput.value.trim();
            if (url && !this.isValidUrl(url)) {
                urlInput.style.borderColor = 'var(--b3-theme-error)';
            } else {
                urlInput.style.borderColor = '';
            }
        });

        featuredSelect.onchange = () => {
            const val = featuredSelect.value;
            if (val) {
                const [name, url] = val.split("|");
                urlInput.value = url;
                nameInput.value = name;
            }
        };

        (dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dialog.destroy();

        confirmBtn.onclick = async () => {
            const url = urlInput.value.trim();
            const name = nameInput.value.trim();
            
            // Validate URL is not empty
            if (!url) { 
                showMessage(this.i18n.feedUrl || "Please enter feed URL", 2000); 
                return; 
            }
            
            // Validate URL format
            if (!this.isValidUrl(url)) {
                showMessage("Invalid URL format. Please enter a valid HTTP/HTTPS URL.", 3000);
                urlInput.focus();
                return;
            }

            // Check if subscription already exists (by URL, normalized)
            const existingSub = this.subscriptions.find(sub => {
                try {
                    return new URL(sub.url).toString() === new URL(url).toString();
                } catch {
                    return sub.url === url;
                }
            });
            if (existingSub) {
                showMessage(`${this.i18n.add} ${this.i18n.failed}: ${this.i18n.subscriptionExists}`, 3000);
                return;
            }

            this.subscriptions.push({
                id: `sub_${Date.now()}`,
                url,
                name: name || url,
                lastFetchTime: Date.now(),
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            // Use smart merge to prevent data loss during sync
            await this.saveSubscriptionsWithMerge();
            
            const rssList = container.querySelector("#rssList");
            if (rssList) {
                rssList.innerHTML = this.renderSubscriptionListHTML();
            }
            dialog.destroy();
            showMessage(this.i18n.add + " " + this.i18n.success, 2000);
        };
    }

    // ==================== Article Display ====================

    private renderArticleList(container: HTMLElement, append: boolean = false) {
        const startTime = DEBUG ? performance.now() : 0;
        this.perfMetrics.renderCount++;
        
        const el = container.querySelector("#rssArticleList") as HTMLElement;
        const perPage = this.settings.articlesPerPage;

        if (!el) return;

        if (!append) {
            this.displayedArticleCount = 0;
            this.isLoadingMore = false;
        }

        const start = this.displayedArticleCount;
        const end = start + perPage;
        const page = this.currentArticles.slice(start, end);
        const hasMore = end < this.currentArticles.length;

        if (page.length === 0 && !append) {
            el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--b3-font-color-quaternary);font-size:13px;">
                    <div style="font-size:24px;margin-bottom:8px;opacity:0.6;"><svg class="block__logoicon" style="width:24px;height:24px;"><use xlink:href="#iconFile"></use></svg></div>
                    <div>${this.i18n.noArticles || 'No articles'}</div>
                </div>`;
            return;
        }

        const fs = this.getFontSizeStyle();
        const html = page.map((article, i) => {
            const gi = start + i;
            const isSelected = this.currentArticleIndex === gi;
            const isUnread = !article.isRead;
            
            // Text styles
            // Selection style: selected=dark gray+bold, unread=default color+bold+primary bar, read=dark gray+normal
            const fontWeight = isSelected ? 'bold' : (isUnread ? 'bold' : 'normal');
            const textColor = isSelected ? '#888888' : (isUnread ? 'var(--b3-font-color)' : '#888888');
            // Show primary color bar for unread and unselected items
            const showUnreadBar = isUnread && !isSelected;
            
            // Use cached thumbnail URL (extracted once during loading)
            const thumbnailUrl = article.thumbnail || '';
            
            return `
                <div class="article-item ${isUnread ? 'is-unread' : ''} ${isSelected ? 'selected' : ''}"
                    data-index="${gi}"
                    style="padding:12px 14px;border-bottom:1px solid var(--b3-border-color);cursor:pointer;display:flex;align-items:flex-start;gap:10px;">
                    
                    <!-- Unread color bar placeholder - status indicator uses 3px space to ensure layout -->
                    <span style="width:3px;height:100%;min-height:20px;flex-shrink:0;${showUnreadBar ? 'background:var(--b3-theme-primary);' : 'background:transparent;'}border-radius:2px;align-self:stretch;margin-top:auto;margin-bottom:auto;"></span>
                    
                    <!-- Thumbnail image container -->
                    ${thumbnailUrl ? `<img src="${thumbnailUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;background:var(--b3-theme-surface-lighter);" loading="lazy" onerror="this.style.display='none'">` : ''}
                    
                    <!-- Article content area -->
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:${fs.listItem};font-weight:${fontWeight};color:${textColor};line-height:1.4;margin-bottom:4px;">
                            ${article.title}
                        </div>
                        <div style="font-size:${fs.listDate};color:var(--b3-font-color-quaternary);">
                            ${article.pubDate ? this.formatDate(article.pubDate) : ''}
                        </div>
                    </div>
                </div>`;
        }).join("");

        if (append) {
            // Remove only the loading indicator, keep existing articles
            const loadingEl = el.querySelector(".loading-more");
            if (loadingEl) loadingEl.remove();
            // Use DocumentFragment for better performance when appending
            const fragment = document.createDocumentFragment();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            while (tempDiv.firstChild) {
                fragment.appendChild(tempDiv.firstChild);
            }
            el.appendChild(fragment);
        } else {
            // For full re-render, use innerHTML (simpler and fast enough for initial load)
            el.innerHTML = html;
        }

        if (hasMore) {
            el.insertAdjacentHTML("beforeend", `<div class="loading-more" style="padding:12px;text-align:center;color:var(--b3-font-color-quaternary);font-size:12px;">
                ↓ ${this.i18n.loadMore} (${this.currentArticles.length - end})
            </div>`);
        }

        this.displayedArticleCount = end;
        // Always setup events (cloning prevents duplicates)
        this.setupArticleListEvents(container);
        
        // Performance tracking
        if (DEBUG && startTime > 0) {
            const duration = performance.now() - startTime;
            this.perfMetrics.totalRenderTime += duration;
            logger.log(`[Perf] Render: ${duration.toFixed(0)}ms (avg: ${(this.perfMetrics.totalRenderTime / this.perfMetrics.renderCount).toFixed(0)}ms, items: ${page.length})`);
        }
    }

    //Fix #5: Infinite scroll - properly append without removing existing items
    private setupInfiniteScroll(container: HTMLElement) {
        const articleList = container.querySelector("#rssArticleList") as HTMLElement;

        // Remove old handler if exists to prevent duplicate listeners
        if (this.listScrollHandler && articleList) {
            articleList.removeEventListener("scroll", this.listScrollHandler);
        }

        this.listScrollHandler = () => {
            // Throttle scroll events to reduce performance overhead (100ms interval)
            if (this.scrollThrottleTimer) return;
            
            this.scrollThrottleTimer = this.safeSetTimeout(() => {
                this.scrollThrottleTimer = null;
                
                // Skip when already loading or no more articles
                if (this.isLoadingMore) return;
                if (this.currentArticles.length === 0) return;

                const { scrollTop, scrollHeight, clientHeight } = articleList;
                if (scrollTop + clientHeight >= scrollHeight - 80) {
                    if (this.displayedArticleCount < this.currentArticles.length) {
                        this.isLoadingMore = true;
                        this.renderArticleList(container, true);
                        // Unlock after a short delay to prevent rapid-fire
                        this.safeSetTimeout(() => { this.isLoadingMore = false; }, 500);
                    }
                }
            }, 100);
        };

        articleList.addEventListener("scroll", this.listScrollHandler);
    }

    // Fix #5: Check if article list is full and auto-load more
    private checkAndLoadMore(container: HTMLElement) {
        if (this.isLoadingMore) return;
        const articleList = container.querySelector("#rssArticleList") as HTMLElement;
        if (!articleList || this.currentArticles.length === 0) return;
        
        // Prevent infinite loop - max 3 retries
        if (this.autoLoadRetryCount >= 3) {
            this.autoLoadRetryCount = 0;
            return;
        }
        
        // Use requestAnimationFrame for accurate DOM measurements
        requestAnimationFrame(() => {
            const { scrollHeight, clientHeight } = articleList;
            // If list doesn't fill the container and there are more articles, load more
            if (scrollHeight <= clientHeight + 10 && this.displayedArticleCount < this.currentArticles.length) {
                this.isLoadingMore = true;
                this.autoLoadRetryCount++;
                this.renderArticleList(container, true);
                // Fix: Only check once after render, don't recursively call
                this.safeSetTimeout(() => {
                    this.isLoadingMore = false;
                    if (this.displayedArticleCount >= this.currentArticles.length) {
                        this.autoLoadRetryCount = 0;
                    }
                }, 150);
            } else {
                this.autoLoadRetryCount = 0;
            }
        });
    }

    // Minimize is handled by SiYuan's data-type="min" mechanism
    // No custom toggleMinimize needed - span with data-type="min" triggers SiYuan's native minimize logic

    private setupArticleListEvents(container: HTMLElement) {
        const articleList = container.querySelector("#rssArticleList");
        if (!articleList) return;

        // Use event delegation instead of cloning to avoid breaking resizer references
        // Check if events are already bound by using a data attribute marker
        if (articleList.getAttribute('data-events-bound') === 'true') {
            return; // Events already bound, skip
        }

        // Click event - using event delegation
        articleList.addEventListener("click", (e) => {
            const item = (e.target as HTMLElement).closest(".article-item");
            if (!item) return;
            const index = parseInt((item as HTMLElement).dataset.index!);
            
            this.currentArticleIndex = index;
            this.selectArticle(index, container);
            
            // Prevent event bubbling to avoid duplicate triggers
            e.stopPropagation();
        });

        // Mark events as bound
        articleList.setAttribute('data-events-bound', 'true');
    }

    private async selectArticle(index: number, container: HTMLElement) {
        const article = this.currentArticles[index];
        if (!article) return;

        // Optimization: Update DOM classes instead of re-rendering entire list
        // Remove 'selected' class from previously selected item
        const prevSelected = container.querySelector('.article-item.selected') as HTMLElement;
        if (prevSelected) {
            prevSelected.classList.remove('selected');
            // Update previous item's styles
            const titleEl = prevSelected.querySelector('[style*="font-weight"]') as HTMLElement;
            if (titleEl) {
                const prevIndex = parseInt(prevSelected.dataset.index || '0');
                const isUnread = !this.currentArticles[prevIndex]?.isRead;
                titleEl.style.fontWeight = isUnread ? 'bold' : 'normal';
                titleEl.style.color = isUnread ? 'var(--b3-font-color)' : '#888888';
            }
            // Show unread bar if needed
            const unreadBar = prevSelected.querySelector('span:first-child') as HTMLElement;
            if (unreadBar) {
                const prevIndex = parseInt(prevSelected.dataset.index || '0');
                const isUnread = !this.currentArticles[prevIndex]?.isRead;
                unreadBar.style.background = isUnread ? 'var(--b3-theme-primary)' : 'transparent';
            }
        }

        // Mark as read (if needed) - use batch save
        if (this.settings.autoMarkRead && !article.isRead) {
            article.isRead = true;
            this.markArticleRead(article.id, article.subscriptionId);
        }

        // Add 'selected' class to new item and update styles
        const newItem = container.querySelector(`.article-item[data-index="${index}"]`) as HTMLElement;
        if (newItem) {
            newItem.classList.add('selected');
            // Update new item's styles
            const titleEl = newItem.querySelector('[style*="font-weight"]') as HTMLElement;
            if (titleEl) {
                titleEl.style.fontWeight = 'bold';
                titleEl.style.color = '#888888';
            }
            // Hide unread bar for selected item
            const unreadBar = newItem.querySelector('span:first-child') as HTMLElement;
            if (unreadBar) {
                unreadBar.style.background = 'transparent';
            }
        }

        // Set article content
        const contentEl = container.querySelector("#rssArticleContent") as HTMLElement;
        const fontSize = this.getFontSizeStyle();
        //Fix #2: Sticky header for article with save button always visible
        contentEl.innerHTML = `
            <div style="position:sticky;top:0;z-index:10;background:var(--b3-theme-background);padding:12px 20px 10px;border-bottom:1px solid var(--b3-border-color);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="flex:1;min-width:0;">
                    <h1 style="font-size:${fontSize.title};font-weight:600;color:var(--b3-font-color);line-height:1.4;margin:0 0 6px;word-break:break-word;">
                        ${article.title}
                    </h1>
                    <div style="font-size:${fontSize.meta};color:var(--b3-font-color-quaternary);display:flex;gap:10px;align-items:center;">
                        <span>${article.pubDate ? this.formatDate(article.pubDate) : ''}</span>
                        <a href="${article.link}" target="_blank" style="color:var(--b3-theme-primary);text-decoration:none;display:flex;align-items:center;gap:2px;">
                            ${this.i18n.originalLink}
                        </a>
                    </div>
                </div>
                <button class="save-to-siyuan-btn" data-article-id="${article.id}" title="${this.i18n.saveNote}" aria-label="${this.i18n.saveNote}">
                    <svg class="block__logoicon"><use xlink:href="#iconRSSSave"></use></svg>
                    <span class="save-to-siyuan-btn-text">${this.i18n.saveNote || 'Save'}</span>
                </button>
            </div>
            <div style="max-width:780px;margin:0 auto;padding:20px;">
                <div style="line-height:1.8;color:var(--b3-font-color);font-size:${fontSize.content};">
                    ${this.sanitizeHTMLForDisplay(article.content || article.description)}
                </div>
            </div>`;

        // Fix #2: Scroll to top when opening article
        contentEl.scrollTop = 0;

        // Re-render subscription list to update unread badge
        const rssList = container.querySelector("#rssList");
        if (rssList) {
            rssList.innerHTML = this.renderSubscriptionListHTML();
        }

        // Fix: Use event delegation to avoid closure memory leak
        // Store current article in a weak reference instead of capturing in closure
        const saveBtn = contentEl.querySelector(".save-to-siyuan-btn") as HTMLButtonElement;
        if (saveBtn) {
            saveBtn.onclick = () => {
                // Lookup article by ID instead of capturing it in closure
                const articleId = saveBtn.getAttribute('data-article-id');
                const currentArticle = this.currentArticles.find(a => a.id === articleId);
                if (currentArticle) {
                    this.saveArticleToSiYuan(currentArticle);
                }
            };
        }
    }

    // ==================== RSS Fetching (via forwardProxy) ====================

    private async fetchAndParseRSS(url: string): Promise<{ items: RSSItem[] }> {
        let xml = "";

        // Strategy 1: browser fetch (bypasses kernel timeout issues)
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FORWARD_PROXY_TIMEOUT);
        try {
            const resp = await fetch(url, {
                signal: controller.signal,
                headers: { "User-Agent": "Mozilla/5.0 (compatible; SiYuan RSS Reader 2.1)" }
            });
            xml = await resp.text();
        } catch (fetchErr) {
            logger.warn("Browser fetch failed, falling back to kernel proxy:", fetchErr);
        } finally {
            clearTimeout(timer);
        }

        // Strategy 2: SiYuan kernel forwardProxy (fallback for CORS/unreachable)
        if (!xml) {
            try {
                const response = await fetchSyncPost("/api/network/forwardProxy", {
                    url: url,
                    method: "GET",
                    timeout: FORWARD_PROXY_TIMEOUT,
                    headers: { "User-Agent": "Mozilla/5.0 (compatible; SiYuan RSS Reader 2.1)" }
                });
                if (response.code !== 0) {
                    throw new Error(`API error: ${response.msg || 'unknown'}`);
                }
                if (response.data?.status >= 400) {
                    throw new Error(`HTTP ${response.data.status}`);
                }
                xml = response.data?.body || "";
            } catch (proxyErr) {
                logger.warn("Kernel proxy fallback also failed:", proxyErr);
            }
        }

        if (!xml) {
            throw new Error(this.i18n.networkError || "Failed to fetch RSS feed");
        }

        // Detect HTML/captcha responses instead of XML
        const trimmed = xml.trimStart();
        if (trimmed.startsWith("<html") || trimmed.startsWith("<!DOCTYPE")) {
            logger.error("Got HTML page instead of RSS (likely anti-bot/captcha):", xml.substring(0, 300));
            throw new Error(this.i18n.htmlNotRss);
        }

        logger.log("Response preview:", xml.substring(0, 500));

        // Parse RSS/Atom XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");

        const parseError = doc.querySelector("parsererror");
        if (parseError) {
            logger.error("XML parse error:", parseError.textContent?.substring(0, 300));
            throw new Error(this.i18n.rssParseFailed);
        }

        // Extract HTML content from XML-parsed element
        // In XML mode, innerHTML is unreliable - use textContent + re-parse as HTML
        const extractHTML = (parent: Element, selector: string): string => {
            const el = parent.querySelector(selector);
            if (!el) return "";
            const raw = el.textContent?.trim() || "";
            if (!raw) return "";
            // If content looks like HTML, re-parse it through DOM for proper rendering
            if (raw.includes("<") && raw.includes(">")) {
                try {
                    const d = document.createElement("div");
                    d.innerHTML = raw;
                    return d.innerHTML;
                } catch { return raw; }
            }
            return raw;
        };

        const items: RSSItem[] = [];

        // RSS 2.0
        const rssItems = doc.querySelectorAll("item");
        if (rssItems.length > 0) {
            rssItems.forEach(itemEl => {
                const title = this.getElText(itemEl, "title");
                const link = this.getElText(itemEl, "link");
                const pubDate = this.getElText(itemEl, "pubDate");
                const descText = this.getElText(itemEl, "description");
                let contentHTML = extractHTML(itemEl, "description");

                // content:encoded has full article HTML (CDATA section)
                itemEl.querySelectorAll("*").forEach(el => {
                    const tag = el.tagName.toLowerCase();
                    if (tag.includes("encoded") || tag === "content") {
                        const raw = el.textContent?.trim() || "";
                        if (raw.length > contentHTML.length) {
                            if (raw.includes("<") && raw.includes(">")) {
                                try {
                                    const d = document.createElement("div");
                                    d.innerHTML = raw;
                                    contentHTML = d.innerHTML;
                                } catch { contentHTML = raw; }
                            } else {
                                contentHTML = raw;
                            }
                        }
                    }
                });

                logger.log("Parsed:", title?.substring(0, 30), "contentLen:", contentHTML.length);

                if (title || link) {
                    items.push({ title: title || "Untitled", link, pubDate, content: contentHTML || descText, description: descText });
                }
            });
            return { items };
        }

        // Atom
        const atomEntries = doc.querySelectorAll("entry");
        if (atomEntries.length > 0) {
            atomEntries.forEach(entry => {
                const title = this.getElText(entry, "title");
                const linkEl = entry.querySelector("link[href]");
                const link = linkEl?.getAttribute("href") || this.getElText(entry, "link");
                const pubDate = this.getElText(entry, "published") || this.getElText(entry, "updated");
                const contentHTML = extractHTML(entry, "content") || extractHTML(entry, "summary");
                const contentText = this.getElText(entry, "content") || this.getElText(entry, "summary");
                items.push({ title: title || "Untitled", link: link || "", pubDate, content: contentHTML || contentText, description: contentText });
            });
            return { items };
        }

        return { items };
    }

    private getElText(parent: Element, selector: string): string {
        const el = parent.querySelector(selector);
        return el?.textContent?.trim() || "";
    }

    private getElHTML(parent: Element, selector: string): string {
        const el = parent.querySelector(selector);
        if (!el) return "";

        // First try innerHTML
        let html = el.innerHTML || "";

        // When innerHTML is empty, textContent may contain actual content like CDATA sections
        const textContent = el.textContent || "";
        if (!html || html.length < textContent.length) {
            html = textContent;
        }

        // Handle special cases where HTML is in textContent but innerHTML is empty, create DOM to parse
        if ((!html || html === textContent) && textContent.includes("<") && textContent.includes(">")) {
            try {
                const temp = document.createElement("div");
                temp.innerHTML = textContent;
                const parsed = temp.innerHTML;
                if (parsed && parsed.length > html.length) {
                    html = parsed;
                }
            } catch {
                // If parsing fails, keep original value
            }
        }

        // Decode HTML entities
        html = html.replace(/&lt;/g, "<")
                   .replace(/&gt;/g, ">")
                   .replace(/&amp;/g, "&")
                   .replace(/&quot;/g, '"')
                   .replace(/&#39;/g, "'");
        return html.trim();
    }

    private async fetchAndCacheArticles(sub: Subscription): Promise<Article[]> {
        const feed = await this.fetchWithRetry(sub, 3);
        const cached = await this.getCachedArticles(sub.id);
    
        const newArticles = feed.items.map(item => {
            // Extract thumbnail once during loading, cache it in article object
            let thumbnailUrl = '';
            const contentToSearch = item.content || item.description || '';
            if (contentToSearch) {
                const imgMatch = contentToSearch.match(/<img[^>]+src=["']([^'"]+)["']/i);
                if (imgMatch) {
                    thumbnailUrl = imgMatch[1];
                }
            }
            const articleId = this.generateArticleId(item.link);
                
            return {
                ...item,
                id: articleId,
                subscriptionId: sub.id,
                isRead: this.readStatus[articleId]?.isRead || false,
                cachedAt: Date.now(),
                thumbnail: thumbnailUrl || undefined // Only set if found
            } as Article;
        });
    
        const merged = this.mergeArticles(newArticles, cached);
        await this.cacheArticles(sub.id, merged);
            
        // Update last fetch time for sync
        sub.lastFetchTime = Date.now();
        sub.updatedAt = Date.now();
            
        return merged;
    }

    // Fetch with exponential backoff retry and request deduplication
    private async fetchWithRetry(sub: Subscription, maxRetries: number): Promise<{ items: RSSItem[] }> {
        // Request lock: prevent duplicate concurrent requests for same subscription
        const lockKey = sub.id;
        if (this.pendingRequests.has(lockKey)) {
            logger.log(`Request already in progress for ${sub.name}, reusing existing promise`);
            return this.pendingRequests.get(lockKey)!;
        }

        // Create the actual fetch promise
        const fetchPromise = (async () => {
            let lastError: Error | null = null;
            
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const startTime = DEBUG ? performance.now() : 0;
                    this.perfMetrics.fetchCount++;
                    
                    const result = await this.fetchAndParseRSS(sub.url);
                    
                    if (DEBUG && startTime > 0) {
                        const duration = performance.now() - startTime;
                        this.perfMetrics.totalFetchTime += duration;
                        logger.log(`[Perf] Fetch ${sub.name}: ${duration.toFixed(0)}ms (avg: ${(this.perfMetrics.totalFetchTime / this.perfMetrics.fetchCount).toFixed(0)}ms)`);
                    }
                    
                    return result;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    logger.warn(`Fetch attempt ${attempt + 1}/${maxRetries + 1} failed for ${sub.name}:`, lastError.message);
                    
                    // Don't retry on last attempt
                    if (attempt < maxRetries) {
                        // Exponential backoff: 1s, 2s, 4s...
                        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                        logger.log(`Retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            
            // All retries failed
            throw lastError || new Error(`Failed to fetch ${sub.name} after ${maxRetries + 1} attempts`);
        })();

        // Store in pending map
        this.pendingRequests.set(lockKey, fetchPromise);

        try {
            return await fetchPromise;
        } finally {
            // Always clean up the lock
            this.pendingRequests.delete(lockKey);
        }
    }

    private generateArticleId(link: string): string {
        let hash = 0;
        for (let i = 0; i < link.length; i++) {
            hash = ((hash << 5) - hash) + link.charCodeAt(i);
            hash = hash & hash;
        }
        return `article_${Math.abs(hash).toString(36)}`;
    }

    private mergeArticles(newArticles: Article[], cachedArticles: Article[]): Article[] {
        const map = new Map<string, Article>();
        cachedArticles.forEach(a => map.set(a.id, a));
        newArticles.forEach(a => {
            const existing = map.get(a.id);
            if (existing) a.isRead = existing.isRead;
            map.set(a.id, a);
        });
        return Array.from(map.values())
            .sort((a, b) => {
                const tA = new Date(a.pubDate).getTime();
                const tB = new Date(b.pubDate).getTime();
                if (isNaN(tA) && isNaN(tB)) return 0;
                if (isNaN(tA)) return 1;
                if (isNaN(tB)) return -1;
                return tB - tA;
            });
    }

    private async getCachedArticles(subId: string): Promise<Article[]> {
        const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
        const entry = cached[subId];
        if (!entry) return [];
        
        // Apply read status from readStatus map to ensure consistency
        return entry.articles.map(article => ({
            ...article,
            isRead: this.readStatus[article.id]?.isRead || article.isRead || false
        }));
    }

    private async cacheArticles(subId: string, articles: Article[]) {
        try {
            // Keep only the latest MAX_CACHED_ARTICLES
            const trimmed = articles.slice(0, MAX_CACHED_ARTICLES);
            const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
            cached[subId] = {
                articles: trimmed,
                cachedAt: Date.now()
            };
            await this.saveData(CACHED_ARTICLES_NAME, cached);
        } catch (error) {
            logger.error("Failed to cache articles:", error);
        }
    }

    /**
     * Update unread counts cache for all subscriptions
     * Used to refresh badge numbers on subscription list items
     */
    private async updateUnreadCounts(subId?: string): Promise<void> {
        try {
            const cached: any = await this.loadData(CACHED_ARTICLES_NAME);
            if (!cached || typeof cached !== 'object') {
                logger.log(`updateUnreadCounts: No cached data found (${CACHED_ARTICLES_NAME})`);
                return;
            }
            
            if (subId) {
                const entry = cached[subId];
                if (entry?.articles) {
                    const unread = entry.articles.filter((a: Article) => {
                        const isRead = this.readStatus[a.id]?.isRead || a.isRead || false;
                        return !isRead;
                    }).length;
                    this.unreadCounts.set(subId, unread);
                    logger.log(`updateUnreadCounts: subId=${subId}, unread=${unread}`);
                }
            } else {
                for (const id of Object.keys(cached)) {
                    const entry = cached[id];
                    if (entry?.articles) {
                        const unread = entry.articles.filter((a: Article) => {
                            const isRead = this.readStatus[a.id]?.isRead || a.isRead || false;
                            return !isRead;
                        }).length;
                        this.unreadCounts.set(id, unread);
                        logger.log(`updateUnreadCounts: id=${id}, unread=${unread}`);
                    }
                }
                logger.log(`updateUnreadCounts: total subscriptions with counts = ${this.unreadCounts.size}`);
            }
        } catch (error) {
            logger.error("Failed to update unread counts:", error);
        }
    }

    /**
     * Batch save read status with debouncing
     * Collects all pending changes and saves them together to reduce I/O operations
     */
    private async batchSaveReadStatus(): Promise<void> {
        // Clear existing timer
        if (this.readStatusSaveTimer) {
            clearTimeout(this.readStatusSaveTimer);
        }

        // Debounce: wait 1 second before saving to batch multiple changes
        this.readStatusSaveTimer = this.safeSetTimeout(async () => {
            if (this.pendingReadStatusChanges.size === 0) return;

            try {
                // Apply all pending changes to readStatus
                for (const [articleId, status] of this.pendingReadStatusChanges.entries()) {
                    this.readStatus[articleId] = status;
                }

                // Merge with storage to preserve entries from other devices
                const stored: ReadStatus = await this.loadData(READ_STATUS_NAME) || {};
                for (const [articleId, status] of Object.entries(stored)) {
                    const existing = this.readStatus[articleId];
                    if (!existing) {
                        // New entry from sync — keep it
                        this.readStatus[articleId] = status;
                    } else if (status.readAt && existing.readAt && status.readAt > existing.readAt) {
                        // Sync'd entry is newer — update
                        this.readStatus[articleId] = status;
                    }
                }

                // Save merged result
                await this.saveData(READ_STATUS_NAME, this.readStatus);

                const savedCount = this.pendingReadStatusChanges.size;
                // Clear pending changes
                this.pendingReadStatusChanges.clear();

                logger.log(`[Batch Save] Saved ${savedCount} read status changes`);

                // Update unread badges on subscription list
                if (this.container?.isConnected) {
                    const rssList = this.container.querySelector("#rssList");
                    if (rssList) {
                        this.updateUnreadCounts().then(() => {
                            rssList.innerHTML = this.renderSubscriptionListHTML();
                        });
                    }
                }
            } catch (error) {
                logger.error("Failed to batch save read status:", error);
            }
        }, 1000); // 1 second debounce
    }

    /**
     * Mark article as read with batching support
     */
    private markArticleRead(articleId: string, subscriptionId?: string): void {
        const now = Date.now();
        this.pendingReadStatusChanges.set(articleId, { isRead: true, readAt: now });
        this.readStatus[articleId] = { isRead: true, readAt: now };
        
        // Update unread badge count for this subscription
        if (subscriptionId) {
            const current = this.unreadCounts.get(subscriptionId) ?? 0;
            if (current > 0) {
                this.unreadCounts.set(subscriptionId, current - 1);
            } else {
                this.unreadCounts.set(subscriptionId, 0);
            }
            this.updateBadgeDOM(subscriptionId);
        }
        
        // Trigger batch save
        this.batchSaveReadStatus();
    }

    private updateBadgeDOM(subscriptionId: string): void {
        if (!this.container?.isConnected) return;
        const index = this.subscriptions.findIndex(s => s.id === subscriptionId);
        if (index < 0) return;
        const badge = this.container.querySelector(`.rss-item[data-index="${index}"] .unread-badge`);
        const count = this.unreadCounts.get(subscriptionId) ?? 0;
        if (badge) {
            if (count > 0) {
                badge.textContent = this.formatUnreadCount(count);
            } else {
                badge.remove();
            }
        }
    }

    private formatUnreadCount(count: number): string {
        return count > 99 ? '99+' : String(count);
    }

    /**
     * Migrate cache format from old Article[] to new CachedArticleEntry
     * Old format: { subId: Article[] }
     * New format: { subId: { articles: Article[], cachedAt: number } }
     */
    private async migrateCacheFormat(): Promise<void> {
        try {
            const cached: any = await this.loadData(CACHED_ARTICLES_NAME);
            if (!cached || typeof cached !== 'object') return;
            
            let needsSave = false;
            for (const [subId, data] of Object.entries(cached)) {
                // Old format: subId -> Article[]
                if (Array.isArray(data)) {
                    cached[subId] = {
                        articles: data,
                        cachedAt: Date.now()
                    };
                    needsSave = true;
                }
            }
            
            if (needsSave) {
                await this.saveData(CACHED_ARTICLES_NAME, cached);
                logger.log("[Cache Migration] Successfully migrated cache format");
            } else {
                logger.log("[Cache Migration] Cache format is already up-to-date");
            }
        } catch (error) {
            logger.error("[Cache Migration] Failed to migrate cache format:", error);
        }
    }

    /**
     * Clean up stale and orphaned cache entries
     * - Remove caches for deleted subscriptions
     * - Remove caches older than 7 days
     */
    private async cleanupCache(): Promise<void> {
        try {
            const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
            const subscriptionIds = new Set(this.subscriptions.map(s => s.id));
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
            
            let cleanedCount = 0;
            let trimmedCount = 0;
            const keysToRemove: string[] = [];
            
            for (const subId of Object.keys(cached)) {
                const entry = cached[subId];
                
                // Remove if subscription no longer exists
                if (!subscriptionIds.has(subId)) {
                    keysToRemove.push(subId);
                    cleanedCount++;
                    continue;
                }
                
                // Remove if cache is older than 7 days
                if (entry.cachedAt < sevenDaysAgo) {
                    keysToRemove.push(subId);
                    cleanedCount++;
                    continue;
                }
                
                // Trim individual articles older than 90 days within active subscriptions
                if (entry.articles && entry.articles.length > 0) {
                    const beforeCount = entry.articles.length;
                    entry.articles = entry.articles.filter(a => {
                        const pubTime = new Date(a.pubDate).getTime();
                        if (isNaN(pubTime)) return true; // Keep articles without valid dates
                        return pubTime > ninetyDaysAgo;
                    });
                    // Also cap by MAX_CACHED_ARTICLES as safety net
                    if (entry.articles.length > MAX_CACHED_ARTICLES) {
                        entry.articles = entry.articles.slice(0, MAX_CACHED_ARTICLES);
                    }
                    trimmedCount += beforeCount - entry.articles.length;
                }
            }
            
            // Remove identified keys
            for (const key of keysToRemove) {
                delete cached[key];
            }
            
            // Save cleaned cache if anything changed
            if (cleanedCount > 0 || trimmedCount > 0) {
                await this.saveData(CACHED_ARTICLES_NAME, cached);
                if (cleanedCount > 0) {
                    logger.log(`[Cache Cleanup] Removed ${cleanedCount} expired cache entries`);
                }
                if (trimmedCount > 0) {
                    logger.log(`[Cache Cleanup] Trimmed ${trimmedCount} old articles (older than 90 days)`);
                }
                // Refresh unread counts after cache modification
                await this.updateUnreadCounts();
                if (this.container?.isConnected) {
                    const rssList = this.container.querySelector("#rssList");
                    if (rssList) {
                        rssList.innerHTML = this.renderSubscriptionListHTML();
                    }
                }
            }
        } catch (error) {
            logger.error("[Cache Cleanup] Failed to clean cache:", error);
        }
    }

    /**
     * Clean up old read status entries to prevent unbounded growth
     * Keep only entries from the last 30 days
     */
    private async cleanupReadStatus(): Promise<void> {
        try {
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days
            const currentSize = Object.keys(this.readStatus).length;
            
            if (currentSize === 0) return;
            
            // Build set of all cached article IDs to identify orphaned entries
            const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
            const cachedArticleIds = new Set<string>();
            for (const entry of Object.values(cached)) {
                if (entry?.articles) {
                    entry.articles.forEach((a: Article) => cachedArticleIds.add(a.id));
                }
            }
            
            let removedCount = 0;
            const keysToRemove: string[] = [];
            
            for (const [articleId, status] of Object.entries(this.readStatus)) {
                if (status.readAt && status.readAt < thirtyDaysAgo) {
                    keysToRemove.push(articleId);
                    removedCount++;
                } else if (!status.readAt && !cachedArticleIds.has(articleId)) {
                    // Entries without readAt (from migration) whose article no longer exists
                    keysToRemove.push(articleId);
                    removedCount++;
                }
            }
            
            // Apply removals
            for (const key of keysToRemove) {
                delete this.readStatus[key];
            }
            
            if (removedCount > 0) {
                await this.saveData(READ_STATUS_NAME, this.readStatus);
                logger.log(`[Read Status Cleanup] Removed ${removedCount} old entries (kept ${currentSize - removedCount})`);
            } else {
                logger.log("[Read Status Cleanup] No old entries to clean");
            }
        } catch (error) {
            logger.error("Failed to cleanup read status:", error);
        }
    }

    private getSubscriptionName(subId: string): string {
        return this.subscriptions.find(s => s.id === subId)?.name || subId;
    }

    // ==================== Actions ====================

    private async markAllRead(container: HTMLElement) {
        if (this.currentArticles.length === 0) return;
        
        // Batch mark all articles as read
        for (const a of this.currentArticles) {
            a.isRead = true;
            this.markArticleRead(a.id);
        }
        
        // Force immediate save for bulk operations
        if (this.readStatusSaveTimer) {
            clearTimeout(this.readStatusSaveTimer);
        }
        await this.batchSaveReadStatus();
        
        if (this.currentSubscriptionIndex >= 0) {
            await this.cacheArticles(this.subscriptions[this.currentSubscriptionIndex].id, this.currentArticles);
            // Update unread count badge
            const currentSubId = this.subscriptions[this.currentSubscriptionIndex].id;
            this.unreadCounts.set(currentSubId, 0);
            const rssList = container.querySelector("#rssList");
            if (rssList) {
                rssList.innerHTML = this.renderSubscriptionListHTML();
            }
        }
        this.renderArticleList(container, false);
        const countEl = container.querySelector("#articleCount") as HTMLElement;
        if (countEl) countEl.textContent = `${this.currentArticles.length}`;
        showMessage(this.i18n.markAllReadSuccess, 2000);
    }

    // Mark all articles of this subscription as read
    private async markSubscriptionRead(index: number, container: HTMLElement) {
        if (index < 0 || index >= this.subscriptions.length) return;
        
        const sub = this.subscriptions[index];
        
        try {
            // Get cached articles or fetch new ones
            let articles = await this.getCachedArticles(sub.id);
            if (!articles || articles.length === 0) {
                articles = await this.fetchAndCacheArticles(sub);
            }
            
            // Mark all articles as read in cache
            let markedCount = 0;
            for (const a of articles) {
                if (!a.isRead) {
                    a.isRead = true;
                    this.markArticleRead(a.id);
                    markedCount++;
                }
            }
            
            // Force immediate save for bulk operations
            if (this.readStatusSaveTimer) {
                clearTimeout(this.readStatusSaveTimer);
            }
            await this.batchSaveReadStatus();
            await this.cacheArticles(sub.id, articles);
            
            showMessage(`${this.i18n.markAllReadSuccess} (${markedCount})`, 2000);
            
            // Update unread count badge for this subscription
            this.unreadCounts.set(sub.id, 0);
            const rssList = container.querySelector("#rssList");
            if (rssList) {
                rssList.innerHTML = this.renderSubscriptionListHTML();
            }
            
            // Always refresh article list if currently viewing this subscription
            // This ensures the UI reflects the updated read status immediately
            if (this.currentSubscriptionIndex === index && this.container) {
                // Update currentArticles in-place to ensure same references
                for (const currentArticle of this.currentArticles) {
                    const cachedArticle = articles.find(a => a.id === currentArticle.id);
                    if (cachedArticle) {
                        // Update the same object reference to trigger re-render
                        currentArticle.isRead = true;
                    }
                }
                // Re-render to show updated read status
                this.renderArticleList(this.container, false);
                
                // Update article count display
                const countEl = this.container.querySelector("#articleCount") as HTMLElement;
                if (countEl) {
                    countEl.textContent = `${this.currentArticles.length}`;
                }
            }
        } catch (error) {
            logger.error("Failed to mark subscription as read:", error);
            showMessage(`${this.i18n.operationFailed}: ${error}`, 3000);
        }
    }

    // Refresh the selected subscription source
    private async refreshSubscription(index: number, container: HTMLElement) {
        if (index < 0 || index >= this.subscriptions.length) return;
        
        showMessage(this.i18n.refreshing, 1000);
        
        try {
            const sub = this.subscriptions[index];
            
            // Get new articles
            const feed = await this.fetchWithRetry(sub, 3);
            const cached = await this.getCachedArticles(sub.id);
            
            // Convert new articles
            const newArticles = feed.items.map(item => ({
                ...item,
                id: this.generateArticleId(item.link),
                subscriptionId: sub.id,
                isRead: this.readStatus[this.generateArticleId(item.link)]?.isRead || false,
                cachedAt: Date.now(),
                thumbnail: this.extractThumbnail(item.content || item.description || '') || undefined
            } as Article));
            
            // Merge articles (preserve read status)
            const merged = this.mergeArticles(newArticles, cached);
            await this.cacheArticles(sub.id, merged);
            
            sub.lastFetchTime = Date.now();
            sub.updatedAt = Date.now();
            // Persist timestamps for sync correctness
            await this.saveSubscriptionsWithMerge();
            
            // Incremental UI update
            await this.updateUIAfterRefresh(index, container, merged);
            
            showMessage(this.i18n.refreshSuccess, 1500);
            
        } catch (error) {
            showMessage(`${this.i18n.refreshFailed}: ${error}`);
        }
    }
    
    // Incremental UI update after refresh
    private async updateUIAfterRefresh(index: number, container: HTMLElement, merged: Article[]) {
        // Always update unread count and badge DOM regardless of current selection
        const unread = merged.filter((a: Article) => !(this.readStatus[a.id]?.isRead || a.isRead || false)).length;
        this.unreadCounts.set(this.subscriptions[index].id, unread);
        if (container?.isConnected) {
            const listEl = container.querySelector("#rssList");
            if (listEl) {
                listEl.innerHTML = this.renderSubscriptionListHTML();
            }
        }
        
        if (this.currentSubscriptionIndex !== index || !container || !container.isConnected) {
            return;
        }
        
        // Save current reading state
        const currentArticleId = this.currentArticles[this.currentArticleIndex]?.id;
        const wasReading = currentArticleId !== undefined;
        
        // Update articles
        this.currentArticles = merged;
        
        // Update article count
        const countEl = container.querySelector("#articleCount") as HTMLElement;
        if (countEl) {
            countEl.textContent = unread > 0 ? `${unread}/${merged.length}` : `${merged.length}`;
        }
        
        // Try to maintain reading state
        if (wasReading && merged.length > 0) {
            if (currentArticleId) {
                const newIndex = merged.findIndex(a => a.id === currentArticleId);
                if (newIndex >= 0) {
                    // Article still exists, maintain reading
                    this.currentArticleIndex = newIndex;
                    this.renderArticleList(container, false);
                } else {
                    // Article removed, select first
                    this.currentArticleIndex = 0;
                    this.selectArticle(0, container);
                }
            }
        } else {
            // No article being read, just update list
            this.renderArticleList(container, false);
        }
    }
    
    private extractThumbnail(content: string): string {
        const imgMatch = content.match(/<img[^>]+src=["']([^'"]+)["']/i);
        return imgMatch ? imgMatch[1] : '';
    }
    
    private applyTemplate(article: Article, content: string, fileName: string, tags: string = "", showLink: boolean = true, showSiteName: boolean = true, showDateTime: boolean = true): string {
        if (!this.settings.useTemplate) {
            // Default format
            let metaLines: string[] = [];
            if (article.pubDate) {
                metaLines.push(`> ${this.i18n.publishedAt} ${new Date(article.pubDate).toLocaleString()}`);
            }
            if (article.link) {
                metaLines.push(`> [Original link](${article.link})`);
            }
            return [
                `# ${fileName}`,
                ...metaLines,
                "",
                content
            ].join("\n");
        }
        
        // Get subscription name
        const subscription = this.subscriptions.find(s => s.id === article.subscriptionId);
        const siteName = subscription?.name || "";
        
        // Format date and time
        const now = new Date();
        const date = now.toISOString().split('T')[0]; // yyyy-MM-dd
        const time = now.toTimeString().slice(0, 5); // HH:mm
        
        // Build content based on user choices
        const lines: string[] = [];
        
        // Top separator
        lines.push("---");
        
        // Meta info lines
        if (showSiteName && siteName) {
            lines.push(`${this.i18n.templateSiteNameLabel}: ${siteName}`);
        }
        
        if (showDateTime) {
            lines.push(`${this.i18n.templateDateTimeLabel}: ${date} ${time}`);
        }
        
        if (showLink && article.link) {
            lines.push(`> [${this.i18n.originalLink}](${article.link})`);
        }
        
        // Bottom separator
        lines.push("---");
        lines.push("");
        
        // Content
        lines.push(content);
        
        return lines.join("\n");
    }

    private async refreshCurrentFeed(container: HTMLElement) {
        if (this.currentSubscriptionIndex < 0) return;
        showMessage(this.i18n.refreshing, 1500);
        await this.selectSubscription(this.currentSubscriptionIndex, container);
        showMessage(this.i18n.refreshSuccess, 1500);
    }

    // Save the new feed source to user's selected notebook
    private async saveArticleToSiYuan(article: Article) {
        try {
            // Get notebook list
            const notebooks = await fetchSyncPost("/api/notebook/lsNotebooks", {});
            const allNotebooks = notebooks.data?.notebooks || [];
            const openNotebooks = allNotebooks.filter((nb: any) => !nb.closed);

            if (!openNotebooks.length) {
                showMessage(this.i18n.noOpenNotebook, 3000);
                return;
            }

            // Show notebook selection dialog
            const result = await this.showNotebookSelectionDialog(openNotebooks);
            if (!result) return; // User cancelled selection
            const { notebookId, tags, showLink, showSiteName, showDateTime } = result;

            let fileName = article.title
                .replace(/[/\\:*?"<>|]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 180);
            if (!fileName) fileName = `RSS_${Date.now()}`;

            // Extract images separately: use htmlToMarkdown to support img/strong/em/links etc.
            const articleHTML = article.content || article.description || "";
            logger.log("Save article:", article.title, "contentLen:", article.content?.length, "descLen:", article.description?.length, "htmlLen:", articleHTML.length);
            logger.log("Content preview (first 500):", articleHTML.substring(0, 500));
            const articleMarkdown = this.htmlToMarkdown(articleHTML);
            logger.log("Markdown length:", articleMarkdown.length, "preview (first 500):", articleMarkdown.substring(0, 500));

            // Apply template
            const fullMd = this.applyTemplate(article, articleMarkdown, fileName, tags, showLink, showSiteName, showDateTime);

            showMessage(`${this.i18n.savingTo}: ${openNotebooks.find((n: any) => n.id === notebookId)?.name || ""}...`, 2000);

            logger.log("Full markdown length:", fullMd.length, "preview:", fullMd.substring(0, 300));

            // Step 1: Create the document and write all content at once
            const res = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: notebookId,
                path: `/${fileName}`,
                markdown: fullMd
            });
            logger.log("Create doc response:", JSON.stringify(res).substring(0, 500));

            let docId: string;
            if (res.code === 201 || res.code === 202) {
                // File already exists, use unique suffix
                const uniqueName = `${fileName}_${Date.now().toString(36)}`;
                const res2 = await fetchSyncPost("/api/filetree/createDocWithMd", {
                    notebook: notebookId,
                    path: `/${uniqueName}`,
                    markdown: fullMd.replace(new RegExp(`# ${fileName}`, 'g'), `# ${uniqueName}`)
                });
                if (!res2.data) {
                    showMessage(`${this.i18n.saveFailed}: ${this.i18n.docExists}`, 3000);
                    return;
                }
                docId = res2.data;
            } else if (!res.data) {
                showMessage(`${this.i18n.saveFailed}: ${this.i18n.docCreateFailed}`, 3000);
                return;
            } else {
                docId = res.data;
            }

            // Step 2: Flush transaction
            await fetchSyncPost("/api/sqlite/flushTransaction", {}).catch(() => {});

            // Step 3: Convert remote images to local assets (reference from siyuan-chrome)
            if (docId) {
                fetchSyncPost("/api/format/netImg2LocalAssets", {
                    id: docId,
                    url: article.link || ""
                }).catch(() => {}); // Ignore failure,不影响保存
            }

            // Step 4: Record last used notebook
            this.settings.lastUsedNotebookId = notebookId;
            await this.saveSettings();

            logger.log("Save complete:", fileName);
            showMessage(`${this.i18n.saved}: ${fileName}`, 4000);

        } catch (error) {
            logger.error("Save error:", error);
            showMessage(`${this.i18n.saveFailed}: ${error}`, 3000);
        }
    }


    //Fix #1: DOM-based HTML→Markdown conversion (replaces fragile regex approach)
    // Regex-based conversion produced malformed markdown that crashed SiYuan's parser,
    // causing "Cannot read properties of null reading 'removeAttribute'" when opening docs.
    private htmlToMarkdown(html: string): string {
        if (!html) return "";

        // Sanitize first to remove dangerous elements
        const sanitized = this.sanitizeHTML(html);
        logger.log("htmlToMarkdown: input len=", html.length, "sanitized len=", sanitized.length);
        logger.log("htmlToMarkdown: sanitized preview=", sanitized.substring(0, 300));

        const temp = document.createElement("div");
        temp.innerHTML = sanitized;
        logger.log("htmlToMarkdown: DOM childNodes=", temp.childNodes.length, "innerHTML len=", temp.innerHTML.length);

        // Debug: log each child node
        Array.from(temp.childNodes).forEach((child, i) => {
            logger.log(`Child ${i}: nodeType=${child.nodeType} nodeName=${child.nodeName}`,
                child.nodeType === 1 ? `tag=${(child as Element).tagName} childCount=${child.childNodes.length}` : `text="${(child.textContent || "").substring(0, 50)}"`);
        });

        const md = this._nodeToMarkdown(temp);
        logger.log("htmlToMarkdown: raw md len=", md.length, "preview=", md.substring(0, 300));

        // Fallback: if DOM-based conversion returned empty but we had content,
        // use a simple regex-based approach
        if (!md.trim() && sanitized.trim()) {
            logger.log("htmlToMarkdown: DOM conversion returned empty, falling back to regex");
            return this.simpleHtmlToMarkdown(sanitized);
        }

        // Clean up whitespace
        return md.replace(/\n{3,}/g, "\n\n").trim();
    }

    private _nodeToMarkdown(node: Node, depth: number = 0): string {
        // Guard against circular DOM references (max depth 50)
        if (depth > 50) {
            logger.log("_nodeToMarkdown: MAX DEPTH reached");
            return "";
        }

        if (node.nodeType === Node.TEXT_NODE) {
            return (node.textContent || "").replace(/&nbsp;/g, " ");
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            if (depth === 0) logger.log("_nodeToMarkdown: non-element at depth 0, type=", node.nodeType);
            return "";
        }

        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        // Debug: log tag at depth 0-1 only to avoid spam
        if (depth <= 1) logger.log(`_nodeToMarkdown: depth=${depth} tag=${tag} children=${el.childNodes.length}`);

        switch (tag) {
            case "br":
                return "\n";
            case "p":
            case "div": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (inner + "\n\n") : "";
            }
            case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
                // Fix: Use correct markdown heading format with # prefix
                const level = parseInt(tag[1]);
                const prefix = "#".repeat(level);
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (`${prefix} ${inner.trim()}\n\n`) : "";
            }
            case "strong":
            case "b": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (`**${inner}**`) : "";
            }
            case "em":
            case "i": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (`*${inner}*`) : "";
            }
            case "u": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (`<u>${inner}</u>`) : "";
            }
            case "s":
            case "del": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (`~~${inner}~~`) : "";
            }
            case "a": {
                const href = el.getAttribute("href") || "";
                const inner = this._nodeToMarkdown(el, depth + 1);
                return href ? (`[${inner}](${href})`) : inner;
            }
            case "img": {
                const src = el.getAttribute("src") || "";
                const alt = el.getAttribute("alt") || "";
                const cls = el.getAttribute("class") || "";
                const width = el.getAttribute("width") || "";
                const height = el.getAttribute("height") || "";
                // Treat emoji/small icon images as inline text
                if (/emoji|emojione|twemoji/.test(cls) || 
                    (width && parseInt(width) <= 32) || 
                    (height && parseInt(height) <= 32)) {
                    return alt || "";
                }
                return src ? (`![${alt}](${src})\n`) : "";
            }
            case "ul": {
                let result = "\n";
                Array.from(el.children).forEach((child) => {
                    if (child.tagName.toLowerCase() === "li") {
                        const inner = this._nodeToMarkdown(child, depth + 1).trim();
                        result += `- ${inner}\n`;
                    }
                });
                return result + "\n";
            }
            case "ol": {
                let result = "\n";
                let count = 1;
                Array.from(el.children).forEach((child) => {
                    if (child.tagName.toLowerCase() === "li") {
                        const inner = this._nodeToMarkdown(child, depth + 1).trim();
                        result += `${count}. ${inner}\n`;
                        count++;
                    }
                });
                return result + "\n";
            }
            case "blockquote": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                const lines = inner.trim().split("\n").filter((l: string) => l.trim());
                if (lines.length === 0) return "";
                return lines.map((l: string) => `> ${l}`).join("\n") + "\n\n";
            }
            case "code": {
                // Only inline code (pre > code handled below)
                if (el.parentElement && el.parentElement.tagName.toLowerCase() === "pre") {
                    return this._nodeToMarkdown(el, depth + 1);
                }
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (`\`${inner}\``) : "";
            }
            case "pre": {
                const codeEl = el.querySelector("code");
                const text = codeEl ? (codeEl.textContent || "") : (el.textContent || "");
                if (!text.trim()) return "";
                // Use triple backticks for code blocks
                const escaped = text.replace(/```/g, "\\`\\`\\`");
                return `\`\`\`
${escaped}
\`\`\`

`;
            }
            case "table": {
                // Build markdown table from HTML table elements
                const rows: string[] = [];
                el.querySelectorAll("tr").forEach((tr) => {
                    const cells: string[] = [];
                    tr.querySelectorAll("td, th").forEach((td) => {
                        cells.push(this._nodeToMarkdown(td, depth + 1).trim().replace(/\|/g, " / "));
                    });
                    if (cells.length > 0) rows.push(cells.join(" | "));
                });
                if (rows.length === 0) return "";
                const colCount = (rows[0]?.match(/\|/g) || []).length + 1;
                const sep = Array(colCount).fill("---").join(" | ");
                // First row as header, separator in the middle, rest as data rows
                const headerRow = rows[0];
                const dataRows = rows.slice(1);
                if (dataRows.length === 0) return "\n" + headerRow + "\n" + sep + "\n\n";
                return "\n" + headerRow + "\n" + sep + "\n" + dataRows.join("\n") + "\n\n";
            }
            case "hr":
                return "\n---\n\n";
            case "script":
            case "style":
            case "iframe":
            case "svg":
                return ""; // Strip dangerous/non-renderable elements
            default: {
                // For unknown elements, just recurse into children
                let result = "";
                Array.from(node.childNodes).forEach((child) => {
                    result += this._nodeToMarkdown(child, depth + 1);
                });
                return result;
            }
        }
    }

    // ==================== Scheduled Updates ====================

    private startScheduledUpdates() {
        this.updateInterval = setInterval(() => this.checkForUpdates(), 30 * 60 * 1000);
        this.checkForUpdates();
        // Daily cache cleanup to automatically remove old articles
        this.cleanupInterval = setInterval(() => this.cleanupCache(), 24 * 60 * 60 * 1000);
    }

    private async checkForUpdates() {
        if (this.subscriptions.length === 0) return;
        let newArticleCount = 0;

        for (const sub of this.subscriptions) {
            try {
                const feed = await this.fetchAndParseRSS(sub.url);
                if (!feed.items?.length) continue;

                const cached = await this.getCachedArticles(sub.id);
                const newItems = feed.items.map(item => ({
                    ...item,
                    id: this.generateArticleId(item.link),
                    subscriptionId: sub.id,
                    cachedAt: Date.now(),
                    thumbnail: this.extractThumbnail(item.content || item.description || '') || undefined
                } as Article));
                const merged = this.mergeArticles(newItems, cached);

                if (merged.length > cached.length) {
                    await this.cacheArticles(sub.id, merged);
                    sub.lastFetchTime = Date.now();
                    sub.updatedAt = Date.now();
                    newArticleCount += merged.length - cached.length;

                    const unread = merged.filter(a =>
                        !(this.readStatus[a.id]?.isRead || a.isRead)
                    ).length;
                    this.unreadCounts.set(sub.id, unread);
                }
            } catch (e) {
                // Silent fail during background checks
            }
        }

        await this.saveSubscriptionsWithMerge();

        if (newArticleCount > 0 && this.container?.isConnected) {
            const listEl = this.container.querySelector("#rssList");
            if (listEl) {
                listEl.innerHTML = this.renderSubscriptionListHTML();
            }
            if (this.currentSubscriptionIndex >= 0) {
                const sub = this.subscriptions[this.currentSubscriptionIndex];
                const merged = await this.getCachedArticles(sub.id);
                if (merged.length > this.currentArticles.length) {
                    await this.updateUIAfterRefresh(
                        this.currentSubscriptionIndex,
                        this.container,
                        merged
                    );
                }
            }
        }

        if (newArticleCount > 0) {
            showMessage(`${this.i18n.newArticles}: ${newArticleCount}`, 3000);
        }
    }

    private setupAutoRefresh() {
        if (this.updateInterval) { clearInterval(this.updateInterval); this.updateInterval = null; }
        if (this.settings.autoRefreshInterval > 0) {
            this.updateInterval = setInterval(() => {
                if (this.container) this.refreshAllFeeds(this.container);
            }, this.settings.autoRefreshInterval * 60 * 1000);
        } else {
            // Keep default background check even when user saves settings with auto-refresh disabled
            this.updateInterval = setInterval(() => this.checkForUpdates(), 30 * 60 * 1000);
        }
    }

    private async refreshAllFeeds(container: HTMLElement) {
        showMessage(this.i18n.refreshing, 2000);
        
        let hasNewArticles = false;
        
        for (const sub of this.subscriptions) {
            try {
                const feed = await this.fetchWithRetry(sub, 3);
                const cached = await this.getCachedArticles(sub.id);
                
                const newArticles = feed.items.map(item => ({
                    ...item,
                    id: this.generateArticleId(item.link),
                    subscriptionId: sub.id,
                    isRead: this.readStatus[this.generateArticleId(item.link)]?.isRead || false,
                    cachedAt: Date.now(),
                    thumbnail: this.extractThumbnail(item.content || item.description || '') || undefined
                } as Article));
                
                const merged = this.mergeArticles(newArticles, cached);
                
                // Check if there are new articles
                if (merged.length > cached.length) {
                    hasNewArticles = true;
                }
                
                await this.cacheArticles(sub.id, merged);
                sub.lastFetchTime = Date.now();
                sub.updatedAt = Date.now();
                
            } catch (e) { 
                /* silent */ 
            }
        }
        
        // Update all subscription badges from refreshed cache
        if (this.container?.isConnected) {
            await this.updateUnreadCounts();
            const listEl = this.container.querySelector("#rssList");
            if (listEl) {
                listEl.innerHTML = this.renderSubscriptionListHTML();
            }
        }
        
        // Update current article list if there are new articles
        if (hasNewArticles && this.currentSubscriptionIndex >= 0 && this.container) {
            const sub = this.subscriptions[this.currentSubscriptionIndex];
            const merged = await this.getCachedArticles(sub.id);
            await this.updateUIAfterRefresh(this.currentSubscriptionIndex, container, merged);
        }
        
        showMessage(hasNewArticles ? this.i18n.newArticles || this.i18n.refreshSuccess : this.i18n.refreshSuccess, 2000);
    }

    // ==================== Dialogs ====================

    // Notebook selection dialog
    private async showNotebookSelectionDialog(notebooks: any[]): Promise<{ notebookId: string; tags: string; showLink: boolean; showSiteName: boolean; showDateTime: boolean } | null> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: `${this.i18n.selectNotebook || 'Select Notebook'}`,
                content: `<div class="b3-dialog__content" style="padding:16px;">
                    <div style="margin-bottom:12px;font-size:13px;color:var(--b3-font-color-tertiary);">${this.i18n.selectSaveLocation || 'Select save location'}</div>
                    <div style="display:flex;align-items:center;gap:12px;">
                        <select class="b3-select fn__block" id="notebookSelect" style="font-size:14px;flex:1;">
                            ${notebooks.map((nb, index) => 
                                `<option value="${nb.id}" ${index === 0 ? 'selected' : ''}>${nb.name}</option>`
                            ).join('')}
                        </select>
                        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap;">
                            <input type="checkbox" class="b3-switch" id="rememberNotebook" checked>
                            ${this.i18n.rememberChoice || 'Remember choice'}
                        </label>
                    </div>
                    
                    <div style="margin-top:16px;">
                        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
                            <input type="checkbox" class="b3-switch" id="useTemplate" ${this.settings.useTemplate ? 'checked' : ''}>
                            ${this.i18n.useTemplate || 'Use template'}
                        </label>
                    </div>
                    
                    <div id="templateOptionsSection" style="${this.settings.useTemplate ? '' : 'display:none;margin-top:16px;'}">
                        <div style="display:flex;flex-wrap:wrap;gap:12px;padding:8px 0;">
                            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 16px 6px 8px;border-radius:4px;background:var(--b3-theme-surface-lighter);">
                                <input type="checkbox" class="template-option" id="templateShowSiteName" ${this.settings.templateShowSiteName ? 'checked' : ''}>
                                ${this.i18n.templateSiteName || 'Site name'}
                            </label>
                            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 16px 6px 8px;border-radius:4px;background:var(--b3-theme-surface-lighter);">
                                <input type="checkbox" class="template-option" id="templateShowDateTime" ${this.settings.templateShowDateTime ? 'checked' : ''}>
                                ${this.i18n.templateDateTime || 'Save date time'}
                            </label>
                            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 16px 6px 8px;border-radius:4px;background:var(--b3-theme-surface-lighter);">
                                <input type="checkbox" class="template-option" id="templateShowLink" ${this.settings.templateShowLink ? 'checked' : ''}>
                                ${this.i18n.templateOriginalLink || 'Original link'}
                            </label>
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button type="button" class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                    <div class="fn__space"></div>
                    <button type="button" class="b3-button b3-button--text" id="confirmNotebook">${this.i18n.confirm}</button>
                </div>`,
                width: "500px",
            });
            requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });

            // Toggle template options section
            const useTemplateCheckbox = dialog.element.querySelector("#useTemplate") as HTMLInputElement;
            const templateOptionsSection = dialog.element.querySelector("#templateOptionsSection") as HTMLElement;
            if (useTemplateCheckbox && templateOptionsSection) {
                useTemplateCheckbox.addEventListener("change", () => {
                    templateOptionsSection.style.display = useTemplateCheckbox.checked ? '' : 'none';
                });
            }

            (dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => {
                dialog.destroy();
                resolve(null);
            };

            dialog.element.querySelector("#confirmNotebook")?.addEventListener("click", () => {
                const select = dialog.element.querySelector("#notebookSelect") as HTMLSelectElement;
                const remember = (dialog.element.querySelector("#rememberNotebook") as HTMLInputElement).checked;
                const notebookId = select.value;
                const useTemplate = (dialog.element.querySelector("#useTemplate") as HTMLInputElement).checked;
                
                // Get template options
                const showLink = (dialog.element.querySelector("#templateShowLink") as HTMLInputElement)?.checked ?? true;
                const showSiteName = (dialog.element.querySelector("#templateShowSiteName") as HTMLInputElement)?.checked ?? true;
                const showDateTime = (dialog.element.querySelector("#templateShowDateTime") as HTMLInputElement)?.checked ?? true;
                
                // Save template settings
                this.settings.useTemplate = useTemplate;
                this.settings.templateShowLink = showLink;
                this.settings.templateShowSiteName = showSiteName;
                this.settings.templateShowDateTime = showDateTime;
                this.saveSettings();
                
                if (remember) {
                    this.settings.lastUsedNotebookId = notebookId;
                    this.saveSettings();
                }
                
                dialog.destroy();
                resolve({ notebookId, tags: "", showLink, showSiteName, showDateTime });
            });
        });
    }
    
    private escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    private showHelpDialog() {
        // IMMEDIATE check to prevent race condition
        if (this.isHelpDialogOpen) {
            return;
        }
        // Set flag SYNCHRONOUSLY before any async operations
        this.isHelpDialogOpen = true;
        logger.log('Opening help dialog');
        
        const dialog = new Dialog({
            title: `${this.i18n.helpTitle}`,
            content: `<div class="b3-dialog__content rss-help-dialog" style="padding:16px;font-size:13px;">
                <div style="display:grid;grid-template-columns:60px 1fr;gap:10px;">
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">J/K</kbd></div><div>${this.i18n.helpPrevNext}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">O</kbd></div><div>${this.i18n.helpOpenOriginal}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">S</kbd></div><div>${this.i18n.helpSaveToSiYuan}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">R</kbd></div><div>${this.i18n.helpRefreshFeed}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">A</kbd></div><div>${this.i18n.helpMarkAllRead}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">?</kbd></div><div>${this.i18n.helpShowHelp}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">Space</kbd></div><div>${this.i18n.helpPageDown}</div>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--text" id="helpDialogClose">OK</button>
            </div>`,
            width: "360px",
            destroyCallback: () => {
                // Reset flag when dialog is closed by any means
                this.isHelpDialogOpen = false;
                logger.log('Help dialog closed');
            }
        });
        
        // Set z-index and add close button handler
        requestAnimationFrame(() => {
            if (dialog.element) {
                dialog.element.style.zIndex = "9999";
                const closeBtn = dialog.element.querySelector('#helpDialogClose');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        dialog.destroy();
                    });
                }
            }
        });
    }

    private showSettingsDialog(container: HTMLElement) {
        const dialog = new Dialog({
            title: this.i18n.settings,
            content: `<div class="b3-dialog__content settings-panel" style="padding:16px;font-size:13px;">
                <div class="b3-label">
                    <label>${this.i18n.articlesPerPage}</label>
                    <select class="b3-select fn__block" id="articlesPerPage">
                        <option value="10" ${this.settings.articlesPerPage === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${this.settings.articlesPerPage === 20 ? 'selected' : ''}>20</option>
                        <option value="30" ${this.settings.articlesPerPage === 30 ? 'selected' : ''}>30</option>
                        <option value="50" ${this.settings.articlesPerPage === 50 ? 'selected' : ''}>50</option>
                    </select>
                    <div class="setting-hint" style="font-size:12px;color:var(--b3-font-color-quaternary);margin-top:4px;">${this.i18n.batchLoadHint}</div>
                </div>
                <div class="b3-label">
                    <label>${this.i18n.fontSize}: <span id="fontSizeValue">${this.settings.fontSize}px</span></label>
                    <input type="range" class="b3-slider fn__block" id="fontSize" min="12" max="20" value="${this.settings.fontSize}" style="margin-top:6px;">
                </div>
                <div class="b3-label">
                    <label>${this.i18n.layoutMode}</label>
                    <select class="b3-select fn__block" id="layoutMode">
                        <option value="vertical" ${this.settings.layout === 'vertical' ? 'selected' : ''}>${this.i18n.vertical}</option>
                        <option value="horizontal" ${this.settings.layout === 'horizontal' ? 'selected' : ''}>${this.i18n.horizontal}</option>
                    </select>
                </div>
                <div class="b3-label">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" class="b3-switch" id="autoMarkRead" ${this.settings.autoMarkRead ? 'checked' : ''}>
                        ${this.i18n.autoMarkRead}
                    </label>
                </div>
                <div class="b3-label">
                    <label>${this.i18n.autoRefresh}</label>
                    <select class="b3-select fn__block" id="autoRefreshInterval">
                        <option value="0" ${this.settings.autoRefreshInterval === 0 ? 'selected' : ''}>${this.i18n.disabled}</option>
                        <option value="15" ${this.settings.autoRefreshInterval === 15 ? 'selected' : ''}>15 ${this.i18n.minutes}</option>
                        <option value="30" ${this.settings.autoRefreshInterval === 30 ? 'selected' : ''}>30 ${this.i18n.minutes}</option>
                        <option value="60" ${this.settings.autoRefreshInterval === 60 ? 'selected' : ''}>1 ${this.i18n.hour}</option>
                    </select>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button type="button" class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                <div class="fn__space"></div>
                <button type="button" class="b3-button b3-button--text" id="saveSettings">${this.i18n.save}</button>
            </div>`,
            width: "400px",
        });
        //Fix z-index to be above sticky header
        requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });

        // Live preview: update font size label as slider moves
        const fontSlider = dialog.element.querySelector("#fontSize") as HTMLInputElement;
        const fontLabel = dialog.element.querySelector("#fontSizeValue") as HTMLSpanElement;
        if (fontSlider && fontLabel) {
            fontSlider.addEventListener("input", () => {
                fontLabel.textContent = `${fontSlider.value}px`;
            });
        }

        (dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dialog.destroy();

        dialog.element.querySelector("#saveSettings")?.addEventListener("click", async () => {
            this.settings.articlesPerPage = parseInt((dialog.element.querySelector("#articlesPerPage") as HTMLSelectElement).value);
            this.settings.fontSize = parseInt((dialog.element.querySelector("#fontSize") as HTMLInputElement).value);
            this.settings.layout = (dialog.element.querySelector("#layoutMode") as HTMLSelectElement).value as 'horizontal' | 'vertical';
            this.settings.autoMarkRead = (dialog.element.querySelector("#autoMarkRead") as HTMLInputElement).checked;
            this.settings.autoRefreshInterval = parseInt((dialog.element.querySelector("#autoRefreshInterval") as HTMLSelectElement).value);

            await this.saveData(SETTINGS_NAME, this.settings);
            this.setupAutoRefresh();
            
            // Re-render entire UI to apply layout and font changes
            // initSidebarUI will rebuild all DOM and rebind events
            
            // Reset selection state to force reload after UI rebuild
            const savedIndex = this.currentSubscriptionIndex;
            this.currentSubscriptionIndex = -1;
            
            this.initSidebarUI(container, true);
            
            // If a subscription was selected, reload its articles
            if (savedIndex >= 0 && savedIndex < this.subscriptions.length) {
                await this.selectSubscription(savedIndex, container);
            }
            
            showMessage(this.i18n.settingsSaved, 2000);
            dialog.destroy();
        });
    }
    // Only for UI display - adds responsive styles (not for markdown conversion)
    private sanitizeHTMLForDisplay(html: string): string {
        let c = this.sanitizeHTML(html);
        c = c.replace(/<img(?![^>]*style=)/gi, '<img style="max-width:100%;height:auto;border-radius:4px;margin:8px 0;" ');
        return c;
    }

    private openRSSReader() {
        showMessage(this.i18n.rssReader, 2000);
    }

    // ==================== Utilities ====================

    // Simple regex-based HTML-to-Markdown fallback (used when DOM-based conversion fails)
    private simpleHtmlToMarkdown(html: string): string {
        let md = html;
        // Headers
        md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
        md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
        md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
        md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
        md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
        md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');
        // Images (before links)
        md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)\n');
        // Links
        md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
        // Bold/italic
        md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**');
        md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*');
        // Block elements and newlines
        md = md.replace(/<\/p>/gi, '\n\n');
        md = md.replace(/<\/div>/gi, '\n');
        md = md.replace(/<br\s*\/?>/gi, '\n');
        md = md.replace(/<hr[^>]*>/gi, '\n---\n');
        // Remove remaining tags
        md = md.replace(/<[^>]+>/g, '');
        // Decode entities
        md = md.replace(/&nbsp;/g, ' ');
        md = md.replace(/&amp;/g, '&');
        md = md.replace(/&lt;/g, '<');
        md = md.replace(/&gt;/g, '>');
        md = md.replace(/&quot;/g, '"');
        // Clean up whitespace
        return md.replace(/\n{3,}/g, '\n\n').trim();
    }

    private stripHTML(html: string): string {
        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    }

    private sanitizeHTML(html: string): string {
        let c = html;
        // Remove dangerous tags and attributes
        c = c.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        c = c.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        c = c.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
        c = c.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
        c = c.replace(/javascript:/gi, '');
        // Fix: Remove extra img attributes style to prevent SiYuan AST parsing error
        c = c.replace(/<img(?![^>]*loading=)/gi, '<img loading="lazy" ');
        // Replace emoji/small icon images with their alt text to prevent them becoming separate blocks
        c = c.replace(/<img[^>]*class=["'][^"']*(?:emoji|emojione|twemoji|apple-emoji)[^"']*["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '$1');
        c = c.replace(/<img[^>]*(?:width|height)=["'](\d+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, (match, dim, alt) => {
            const dimNum = parseInt(dim);
            if (dimNum <= 32) return alt;
            return match;
        });
        return c;
    }

    /**
     * Validate URL format
     * @param url - URL string to validate
     * @returns true if URL is valid HTTP/HTTPS URL
     */
    private isValidUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            // Only allow http and https protocols
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch (error) {
            return false;
        }
    }

    private formatDate(dateStr: string): string {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const diff = Date.now() - date.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return this.i18n.justNow;
        if (mins < 60) return `${mins}${this.i18n.minutesAgo}`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}${this.i18n.hoursAgo}`;
        const days = Math.floor(hours / 24);
        if (days === 1) return this.i18n.yesterday;
        if (days < 7) return `${days}${this.i18n.daysAgo}`;
        // @ts-ignore
        const lang = window.siyuan?.config?.lang || 'en';
        const locale = lang.replace('_', '-');
        return date.toLocaleDateString(locale);
    }
}


