import {
    Plugin,
    showMessage,
    Dialog,
    fetchSyncPost,
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
const MAX_CACHED_ARTICLES = 100;

interface Subscription {
    id: string;
    url: string;
    name: string;
    lastFetchTime?: number;
}

interface RSSItem {
    title: string;
    link: string;
    pubDate: string;
    content: string;
    description: string;
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

interface CachedArticles {
    [subscriptionId: string]: Article[];
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
    showUnreadOnly: boolean;
    fontSize: number; // 12-20px
    autoRefreshInterval: number;
    lastUsedNotebookId?: string;
}

const defaultSettings: Settings = {
    articlesPerPage: DEFAULT_ARTICLES_PER_PAGE,
    autoMarkRead: true,
    layout: 'vertical',
    enableKeyboardShortcuts: true,
    showUnreadOnly: false,
    fontSize: 14,
    autoRefreshInterval: 0,
    lastUsedNotebookId: "",
};

const SHORTCUTS = {
    NEXT_ARTICLE: 'j',
    PREV_ARTICLE: 'k',
    OPEN_ORIGINAL: 'o',
    SAVE_TO_SIYUAN: 's',
    REFRESH: 'r',
    MARK_ALL_READ: 'a',
    HELP: '?'
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
    // Track if subscription events are bound to prevent duplicates
    private subscriptionEventsBound: boolean = false;
    // Request lock map to prevent duplicate concurrent requests per subscription (stores raw feed data)
    private pendingRequests: Map<string, Promise<{ items: RSSItem[] }>> = new Map();
    // Cache expiration time (5 minutes) - avoid unnecessary re-fetches
    private readonly CACHE_EXPIRY_MS = 5 * 60 * 1000;
    // Track last background fetch time per subscription to debounce rapid switches
    private lastBackgroundFetchTime: Map<string, number> = new Map();
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
    private topBarObserver: MutationObserver | null = null;
    private themeObserver: MutationObserver | null = null;

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
        
        logger.log('Custom icons registered successfully (8 icons): iconRSSMain, iconRSSAdd, iconRSSRefresh, iconRSSCheck, iconRSSHelp, iconRSSSettings, iconRSSSave, iconRSSDelete, iconRSSMinimize');
    }

    // ==================== Lifecycle ====================

    async onload() {

        await this.loadSettings();
        
        // Fix #3: Auto-detect SiYuan language setting
        this.detectLanguage();

        const data = await this.loadData(STORAGE_NAME);
        this.subscriptions = data || [];

        // Migration: remove 36kr (anti-bot blocks it) from saved subscriptions
        const before = this.subscriptions.length;
        this.subscriptions = this.subscriptions.filter(s => !s.url.includes("36kr.com"));
        if (this.subscriptions.length < before) {
            logger.log("Migration: removed 36kr from subscriptions");
            await this.saveData(STORAGE_NAME, this.subscriptions);
        }

        const status = await this.loadData(READ_STATUS_NAME);
        this.readStatus = status || {};

        this.boundHandleKeyboard = this.handleKeyboard.bind(this);

        // Register custom icons for the plugin
        this.registerCustomIcons();

        // Register command to show plugin menu item in command palette
        this.addCommand({
            langKey: "openRssReader",
            hotkey: "",
            callback: () => {
                // Toggle the dock panel visibility
                const dockPanel = document.querySelector('[data-type="rss_reader_dock"]') as HTMLElement;
                if (dockPanel) {
                    // Dock is visible, hide it by triggering SiYuan's minimize
                    const minBtn = dockPanel.querySelector('[data-type="min"]') as HTMLElement;
                    if (minBtn) minBtn.click();
                } else {
                    // Dock is not visible, show it by clicking the dock icon button in bottom bar
                    const dockIconBtn = document.querySelector('.dock__item[data-type="rss_reader_dock"]') as HTMLElement;
                    if (dockIconBtn) dockIconBtn.click();
                }
            }
        });

        // NOTE: addTopBar() moved to onLayoutReady() for SiYuan 3.3+ compatibility

        const plugin = this;
        this.addDock({
            type: "rss_reader_dock",
            config: {
                position: "RightBottom",
                size: { width: 400, height: 300 },
                icon: "iconRSSMain",
                title: this.i18n.rssReader,
            },
            data: {},
            init: function (this: any, dock: any) {
                try {
                    plugin.container = this.element;
                    plugin.initSidebarUI(this.element);
                    // Toolbar is now built into the title bar (initSidebarUI), no need for separate dock header injection
                } catch (err) {
                    logger.error("[RSS] Dock init error:", err);
                }
            }
        });

        this.startScheduledUpdates();
        this.registerKeyboardShortcuts();
    }

    // SiYuan 3.3+: addTopBar() must be called in onLayoutReady(), not onload()
    onLayoutReady() {
        // Add top bar icon - REQUIRED for plugin to appear in Settings → Plugins management list
        // We'll hide this icon to avoid duplicate icons (Dock already has one)
        const topBarElement = this.addTopBar({
            icon: "iconRSSMain",
            title: this.i18n.rssReader,
            position: "right",
            callback: () => {
                // Toggle the dock panel visibility when clicking top bar icon
                const dockPanel = document.querySelector('[data-type="rss_reader_dock"]') as HTMLElement;
                if (dockPanel) {
                    const minBtn = dockPanel.querySelector('[data-type="min"]') as HTMLElement;
                    if (minBtn) minBtn.click();
                } else {
                    const dockIconBtn = document.querySelector('.dock__item[data-type="rss_reader_dock"]') as HTMLElement;
                    if (dockIconBtn) dockIconBtn.click();
                }
            }
        });
        
        // Hide the top bar icon immediately
        if (topBarElement) {
            topBarElement.style.display = 'none';
            topBarElement.style.visibility = 'hidden';
            topBarElement.style.width = '0';
            topBarElement.style.height = '0';
            topBarElement.style.padding = '0';
            topBarElement.style.margin = '0';
            topBarElement.style.overflow = 'hidden';
            
            // Use MutationObserver to ensure it stays hidden (SiYuan might reset styles)
            this.topBarObserver = new MutationObserver(() => {
                if (topBarElement.style.display !== 'none') {
                    topBarElement.style.display = 'none';
                    topBarElement.style.visibility = 'hidden';
                }
            });
            this.topBarObserver.observe(topBarElement, { attributes: true, attributeFilter: ['style'] });
        }
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
        
        // Clear all pending timeouts
        this.clearAllTimeouts();
        
        // Clear debounce timer
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        
        // Cancel all pending network requests
        this.pendingRequests.clear();
        
        // Disconnect MutationObservers to prevent memory leaks
        if (this.topBarObserver) {
            this.topBarObserver.disconnect();
            this.topBarObserver = null;
        }
        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }
        
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
        
        // Cleanup scroll handler
        if (this.container) {
            const articleList = this.container.querySelector("#rssArticleList");
            if (articleList && this.listScrollHandler) {
                articleList.removeEventListener("scroll", this.listScrollHandler);
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
            const lang = window.siyuan?.config?.lang || "en_US";
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
            showMessage(this.i18n.saveFailed || "��������ʧ��", 3000);
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
        // Ignore keyboard shortcuts when typing in input/textarea/select
        if ((e.target as HTMLElement).tagName === 'INPUT' ||
            (e.target as HTMLElement).tagName === 'TEXTAREA' ||
            (e.target as HTMLElement).tagName === 'SELECT') {
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
        }
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

    // ==================== UI ====================

private initSidebarUI(container: HTMLElement) {
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
        this.isResizing = false;
        
        const isH = this.settings.layout === 'horizontal';
        const listFlex = isH ? '0 0 35%' : '0 0 40%';
        const listBorder = isH ? 'border-right:1px solid var(--b3-border-color)' : 'border-bottom:1px solid var(--b3-border-color)';
        const listMin = isH ? 'min-width:120px' : 'min-height:80px';
        const resizerStyle = isH ? 'width:4px;cursor:col-resize' : 'height:4px;cursor:row-resize';
        const contentDir = isH ? 'row' : 'column';

        container.innerHTML = `
            <div class="rss-reader-container" style="width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative;">
                <!-- Title bar -->
                <div id="rssTitleBar" style="flex-shrink:0;display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid var(--b3-border-color);background:var(--b3-theme-surface);min-height:32px;">
                    <svg style="width:16px;height:16px;flex-shrink:0;margin-right:6px;"><use xlink:href="#iconRSSMain"></use></svg>
                    <span style="font-size:13px;font-weight:600;color:var(--b3-font-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">RSS Reader</span>
                    <div style="flex:1;"></div>
                    <!-- Settings, Help, Minimize buttons -->
                    <button id="tbSettings" title="${this.i18n.settings}"><svg class="title-bar-btn-icon"><use xlink:href="#iconRSSSettings"></use></svg></button>
                    <button id="tbHelp" title="${this.i18n.help}"><svg class="title-bar-btn-icon"><use xlink:href="#iconRSSHelp"></use></svg></button>
                    <span data-type="min" title="${this.i18n.minimize}"><svg class="title-bar-btn-icon"><use xlink:href="#iconRSSMinimize"></use></svg></span>
                </div>
                <!-- Content area below title bar -->
                <div style="flex:1;display:flex;overflow:hidden;">
                    <!-- Left: subscription sidebar -->
                    <div id="rssSidebar" class="rss-sidebar" style="width:20%;min-width:min-content;max-width:35%;border-right:1px solid var(--b3-border-color);display:flex;flex-direction:column;background:var(--b3-theme-surface);flex-shrink:0;">
                        <!-- Subscription list (includes add button) -->
                        <div id="rssList" class="rss-list" style="flex:1;overflow-y:auto;padding:4px;">
                            ${this.renderSubscriptionListHTML()}
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
    }

    private setupEventListeners(container: HTMLElement) {
        // Bind title bar toolbar buttons
        const bind = (id: string, fn: () => void) => {
            container.querySelector('#' + id)?.addEventListener('click', fn);
        };
        // Note: tbAdd is now inside #rssList and handled by event delegation in setupSubscriptionEvents
        bind('tbRefresh', () => this.refreshCurrentFeed(container));
        bind('tbMarkRead', () => this.markAllRead(container));
        bind('tbSettings', () => this.showSettingsDialog(container));
        bind('tbHelp', () => this.showHelpDialog());
        // Minimize uses data-type="min" - SiYuan handles automatically

        // SiYuan built-in block__icon class handles hover styles automatically

        this.setupSubscriptionEvents(container);
        this.setupResizerEvents(container);
    }

    private renderSubscriptionListHTML(): string {
        let html = '';
        
        if (this.subscriptions.length === 0) {
            // When empty: show "+" button first, then empty state message
            html += `<div style="padding:4px;display:flex;justify-content:center;">
                <button id="tbAdd" title="${this.i18n.add}" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color-quaternary);background:transparent;border:1px solid transparent;cursor:pointer;border-radius:6px;transition:all 0.2s;" onmouseenter="this.style.borderColor='#26c6da';this.style.color='#26c6da';" onmouseleave="this.style.borderColor='transparent';this.style.color='var(--b3-font-color-quaternary)';">
                    <svg style="width:18px;height:18px;color:inherit;"><use xlink:href="#iconRSSAdd"></use></svg>
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
                    <div class="subscription-name" data-index="${index}" style="flex:1;min-width:0;padding:2px 4px;">
                        <div style="font-size:${fs.listItem};font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--b3-font-color);">
                            ${sub.name || sub.url}
                        </div>
                    </div>
                    <!-- Action buttons: Mark Read, Refresh, Delete -->
                    <button class="mark-read-rss" data-index="${index}" title="${this.i18n.markAllRead}" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;cursor:pointer;color:var(--b3-font-color-quaternary);border-radius:4px;transition:all 0.2s;pointer-events:auto;z-index:10;flex-shrink:0;" onmouseenter="this.style.borderColor='#ffa726';this.style.color='#ffa726';" onmouseleave="this.style.borderColor='transparent';this.style.color='var(--b3-font-color-quaternary)';">
                        <svg style="width:16px;height:16px;pointer-events:none;color:inherit;"><use xlink:href="#iconRSSCheck"></use></svg>
                    </button>
                    <button class="refresh-rss" data-index="${index}" title="${this.i18n.refresh}" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;cursor:pointer;color:var(--b3-font-color-quaternary);border-radius:4px;transition:all 0.2s;pointer-events:auto;z-index:10;flex-shrink:0;" onmouseenter="this.style.borderColor='var(--b3-theme-success)';this.style.color='var(--b3-theme-success)';" onmouseleave="this.style.borderColor='transparent';this.style.color='var(--b3-font-color-quaternary)';">
                        <svg style="width:16px;height:16px;pointer-events:none;color:inherit;"><use xlink:href="#iconRSSRefresh"></use></svg>
                    </button>
                    <button class="delete-rss" data-index="${index}" title="${this.i18n.delete}" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;cursor:pointer;color:var(--b3-font-color-quaternary);border-radius:4px;transition:all 0.2s;pointer-events:auto;z-index:10;flex-shrink:0;" onmouseenter="this.style.borderColor='var(--b3-theme-error)';this.style.color='var(--b3-theme-error)';" onmouseleave="this.style.borderColor='transparent';this.style.color='var(--b3-font-color-quaternary)';">
                        <svg style="width:16px;height:16px;pointer-events:none;color:inherit;"><use xlink:href="#iconRSSDelete"></use></svg>
                    </button>
                </div>
            `).join("");
            
            // Add button at bottom of subscription list
            html += `<div style="padding:4px;display:flex;justify-content:center;">
                <button id="tbAdd" title="${this.i18n.add}" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color-quaternary);background:transparent;border:1px solid transparent;cursor:pointer;border-radius:6px;transition:all 0.2s;" onmouseenter="this.style.borderColor='#26c6da';this.style.color='#26c6da';" onmouseleave="this.style.borderColor='transparent';this.style.color='var(--b3-font-color-quaternary)';">
                    <svg style="width:18px;height:18px;color:inherit;"><use xlink:href="#iconRSSAdd"></use></svg>
                </button>
            </div>`;
        }
        
        return html;
    }

    private setupSubscriptionEvents(container: HTMLElement) {
        // Prevent duplicate event binding
        if (this.subscriptionEventsBound) return;
        this.subscriptionEventsBound = true;
        
        const rssList = container.querySelector("#rssList");
        if (!rssList) return;

        // Handle hover effects with mouseover/mouseout (bubbling events)
        rssList.addEventListener("mouseover", (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest(".mark-read-rss, .refresh-rss, .delete-rss");
            if (btn) {
                const button = btn as HTMLElement;
                if (button.classList.contains('delete-rss')) {
                    // ɾ����ť - ��ɫ����
                    button.style.background = 'var(--b3-theme-error-light)';
                    button.style.borderColor = 'var(--b3-theme-error)';
                    button.style.color = 'var(--b3-theme-error)';
                } else if (button.classList.contains('refresh-rss')) {
                    // ˢ�°�ť - ��ɫ
                    button.style.background = 'rgba(16, 185, 129, 0.15)';
                    button.style.borderColor = 'rgb(16, 185, 129)';
                    button.style.color = 'rgb(16, 185, 129)';
                } else if (button.classList.contains('mark-read-rss')) {
                    // ����Ѷ���ť - ��ɫ
                    button.style.background = 'rgba(59, 130, 246, 0.15)';
                    button.style.borderColor = 'rgb(59, 130, 246)';
                    button.style.color = 'rgb(59, 130, 246)';
                }
            }
        });

        rssList.addEventListener("mouseout", (e) => {
            const target = e.target as HTMLElement;
            const relatedTarget = (e as MouseEvent).relatedTarget as HTMLElement;
            const btn = target.closest(".mark-read-rss, .refresh-rss, .delete-rss");
            
            // Only reset if we're actually leaving the button (not entering a child element)
            if (btn && !btn.contains(relatedTarget)) {
                const button = btn as HTMLElement;
                button.style.background = 'transparent';
                button.style.borderColor = 'transparent';
                button.style.color = 'var(--b3-font-color-quaternary)';
            }
        });

        // Handle click events
        rssList.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            
            // Handle add button click
            const addBtn = target.closest("#tbAdd");
            if (addBtn) {
                e.stopPropagation();
                this.showAddSubscriptionDialog(container);
                return;
            }
            
            // Handle delete button click
            const deleteBtn = target.closest(".delete-rss");
            if (deleteBtn) {
                e.stopPropagation();
                const index = parseInt((deleteBtn as HTMLElement).dataset.index!);
                this.deleteSubscription(index, container);
                return;
            }
            
            // Handle refresh button click
            const refreshBtn = target.closest(".refresh-rss");
            if (refreshBtn) {
                e.stopPropagation();
                const index = parseInt((refreshBtn as HTMLElement).dataset.index!);
                this.refreshSubscription(index, container);
                return;
            }
            
            // Handle mark read button click
            const markReadBtn = target.closest(".mark-read-rss");
            if (markReadBtn) {
                e.stopPropagation();
                const index = parseInt((markReadBtn as HTMLElement).dataset.index!);
                this.markSubscriptionRead(index, container);
                return;
            }
            
            // Handle subscription item click (only if clicking on the name area)
            const nameArea = target.closest(".subscription-name");
            if (nameArea) {
                const index = parseInt((nameArea as HTMLElement).dataset.index!);
                this.selectSubscription(index, container);
            }
        });
    }

    // ==================== Resizer ====================

    // Add toolbar buttons to dock header (top-right, like Graph View)
    private addToolbarToDockHeader(container: HTMLElement) {
        // Wait for dock to be fully rendered
        this.safeSetTimeout(() => {
            this.doAddToolbarToDockHeader(container);
        }, 100);
    }

    private doAddToolbarToDockHeader(container: HTMLElement) {
        // Find the dock panel by data-type
        const dockPanel = document.querySelector('[data-type="rss_reader_dock"]') as HTMLElement;
        if (!dockPanel) {
            logger.warn('Dock panel not found for toolbar');
            return;
        }

        // SiYuan dock structure: the header is typically the first flex row
        // Look for any element that contains a close button
        let header: HTMLElement | null = null;
        
        // Strategy 1: Find by close button parent
        const closeBtn = dockPanel.querySelector('[data-type="close"]') as HTMLElement;
        if (closeBtn && closeBtn.parentElement) {
            header = closeBtn.parentElement as HTMLElement;
        }
        
        // Strategy 2: Find by common dock header classes
        if (!header) {
            header = dockPanel.querySelector('.dock__header, .layout__tab--header, [class*="header"]') as HTMLElement | null;
        }
        
        // Strategy 3: First non-column flex child
        if (!header) {
            const children = Array.from(dockPanel.children);
            for (const child of children) {
                const el = child as HTMLElement;
                const style = window.getComputedStyle(el);
                if (style.display === 'flex' && !el.classList.contains('fn__flex-column')) {
                    header = el;
                    break;
                }
            }
        }

        if (!header) {
            logger.warn('Dock header not found - all strategies failed');
            return;
        }

        // Check if toolbar already added
        if (header.querySelector('#rssDockToolbar')) return;

        // Ensure header has flex layout (like Graph View)
        header.style.display = 'flex';
        header.style.alignItems = 'center';

        // Add left title section (icon + plugin name) if not exists
        if (!header.querySelector('.rss-dock-title')) {
            const titleSection = document.createElement('div');
            titleSection.className = 'rss-dock-title fn__flex';
            titleSection.style.cssText = 'align-items:center; flex-shrink:0; padding:0 8px;';
            titleSection.innerHTML = `
                <svg class="block__logoicon" style="width:16px;height:16px;margin-right:6px;">
                    <use xlink:href="#iconRSSMain"></use>
                </svg>
                <span class="block__text">RSS Reader</span>
            `;
            header.insertBefore(titleSection, header.firstChild);
        }

        // Create toolbar container (like Graph View's right-side icon group)
        const toolbar = document.createElement('div');
        toolbar.id = 'rssDockToolbar';
        toolbar.className = 'fn__flex';
        toolbar.style.cssText = 'align-items:center; margin-left:auto; flex-shrink:0;';

        // SiYuan built-in SVG icons (same style as Graph View)
        toolbar.innerHTML = [
            { id: 'dockAddRSS',       icon: 'iconPlus',      tip: this.i18n.add },
            { id: 'dockRefreshBtn',   icon: 'iconRefresh',   tip: this.i18n.refresh },
            { id: 'dockMarkAllReadBtn', icon: 'iconCheck',   tip: this.i18n.markAllRead },
            { id: 'dockSettingsBtn',  icon: 'iconSetting', tip: this.i18n.settings },
            { id: 'dockHelpBtn',      icon: 'iconQuestionCircle',     tip: this.i18n.help },
        ].map(btn =>
            `<button class="block__icon" title="${btn.tip}" id="${btn.id}">` +
                `<svg><use xlink:href="#${btn.icon}"></use></svg></button>`
        ).join('<span class="fn__space"></span>');

        // Insert before the close button (rightmost position, like Graph View)
        const closeButton = header.querySelector('[data-type="close"]') 
                       || header.querySelector('.block__icon[data-type="close"]')
                       || header.lastElementChild;
        if (closeButton) {
            header.insertBefore(toolbar, closeButton);
        } else {
            header.appendChild(toolbar);
        }

        // Bind events
        const bind = (id: string, fn: () => void) => {
            toolbar.querySelector('#' + id)?.addEventListener('click', fn);
        };
        bind('dockAddRSS', () => { if (this.container) this.showAddSubscriptionDialog(this.container); });
        bind('dockRefreshBtn', () => { if (this.container) this.refreshCurrentFeed(this.container); });
        bind('dockMarkAllReadBtn', () => { if (this.container) this.markAllRead(this.container); });
        bind('dockSettingsBtn', () => { if (this.container) this.showSettingsDialog(this.container); });
        bind('dockHelpBtn', () => { this.showHelpDialog(); });
    }

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
                if (this.settings.layout === 'horizontal') {
                    startX = e.clientX;
                    startPct = (currentArticleList.offsetWidth / parent.offsetWidth) * 100;
                } else {
                    startY = e.clientY;
                    startPct = (currentArticleList.offsetHeight / parent.offsetHeight) * 100;
                }
                vResizer.style.background = "var(--b3-theme-primary)";
                const cursor = this.settings.layout === 'horizontal' ? 'col-resize' : 'row-resize';
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
                    if (this.settings.layout === 'horizontal') {
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

    private async selectSubscription(index: number, container: HTMLElement) {
        // Prevent reloading if already selected
        if (this.currentSubscriptionIndex === index) {
            logger.log("Subscription already selected, skipping reload");
            return;
        }
        
        this.currentSubscriptionIndex = index;
        this.displayedArticleCount = 0;
        this.currentArticles = [];
        this.currentArticleIndex = -1; // ����ѡ����������
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
                this.renderArticleList(container);
                this.safeSetTimeout(() => this.checkAndLoadMore(container), 100);
                
                // Smart background refresh: only fetch if cache is old or user explicitly requests
                const lastFetch = this.lastBackgroundFetchTime.get(sub.id) || 0;
                const cacheAge = Date.now() - lastFetch;
                
                // Only auto-refresh if cache is older than 5 minutes AND no pending request
                if (cacheAge > this.CACHE_EXPIRY_MS && !this.pendingRequests.has(sub.id)) {
                    this.lastBackgroundFetchTime.set(sub.id, Date.now());
                    
                    this.fetchAndCacheArticles(sub).then(articles => {
                        // Only update if user hasn't switched to another subscription
                        if (this.currentSubscriptionIndex === index) {
                            this.currentArticles = articles;
                            this.displayedArticleCount = 0;
                            if (countEl) {
                                const unread = articles.filter(a => !a.isRead).length;
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
                this.renderArticleList(container);
                // Fix #5: Auto-load more if list doesn't fill the container
                this.safeSetTimeout(() => this.checkAndLoadMore(container), 100);
            }
        } catch (error) {
            logger.error("Failed to fetch RSS:", error);
            const msg = error instanceof Error ? error.message : String(error);
            articleListEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--b3-theme-error);font-size:13px;">
               ${this.i18n.networkError}: ${msg}
            </div>`;
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

        this.subscriptions.splice(index, 1);

        if (sub.id) {
            try {
                const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
                delete cached[sub.id];
                await this.saveData(CACHED_ARTICLES_NAME, cached);
            } catch (error) {
                logger.error("Failed to delete cached articles:", error);
            }
        }

        try {
            await this.saveData(STORAGE_NAME, this.subscriptions);
        } catch (error) {
            logger.error("Failed to save subscriptions after delete:", error);
            showMessage(this.i18n.saveFailed || "����ʧ��", 3000);
        }

        if (this.currentSubscriptionIndex === index) {
            this.currentSubscriptionIndex = -1;
            this.currentArticles = [];
            this.currentArticleIndex = -1;
            const articleListEl = container.querySelector("#rssArticleList") as HTMLElement;
            articleListEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">${this.i18n.selectArticle}</div>`;
            const contentEl = container.querySelector("#rssArticleContent") as HTMLElement;
            contentEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">${this.i18n.selectArticle}</div>`;
            const countEl = container.querySelector("#articleCount") as HTMLElement;
            if (countEl) countEl.textContent = "";
        } else if (this.currentSubscriptionIndex > index) {
            this.currentSubscriptionIndex--;
        }

        container.querySelector("#rssList")!.innerHTML = this.renderSubscriptionListHTML();
        this.setupSubscriptionEvents(container);
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
            if (!url) { showMessage(this.i18n.feedUrl, 2000); return; }

            // Check if subscription already exists (by URL)
            const existingSub = this.subscriptions.find(sub => sub.url === url);
            if (existingSub) {
                showMessage(`${this.i18n.add} ${this.i18n.failed}: ${this.i18n.subscriptionExists}`, 3000);
                return;
            }

            this.subscriptions.push({
                id: `sub_${Date.now()}`,
                url,
                name: name || url,
                lastFetchTime: Date.now()
            });

            await this.saveData(STORAGE_NAME, this.subscriptions);
            container.querySelector("#rssList")!.innerHTML = this.renderSubscriptionListHTML();
            this.setupSubscriptionEvents(container);
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

        if (!append) {
            this.displayedArticleCount = 0;
            this.isLoadingMore = false;
            // Clear event bound marker when re-rendering from scratch
            el.removeAttribute('data-events-bound');
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
            
            // ������ʽ
            // ѡ�����ȣ�ѡ��=ǳ��ɫ+�Ӵ֣�δ��=Ĭ��ɫ+�Ӵ�+ɫ�����Ѷ�=ǳ��ɫ+����
            const fontWeight = isSelected ? 'bold' : (isUnread ? 'bold' : 'normal');
            const textColor = isSelected ? '#888888' : (isUnread ? 'var(--b3-font-color)' : '#888888');
            // δ����δѡ�У���ʾɫ��
            const showUnreadBar = isUnread && !isSelected;
            
            // Use cached thumbnail URL (extracted once during loading)
            const thumbnailUrl = article.thumbnail || '';
            
            return `
                <div class="article-item ${isUnread ? 'is-unread' : ''} ${isSelected ? 'selected' : ''}"
                    data-index="${gi}"
                    style="padding:12px 14px;border-bottom:1px solid var(--b3-border-color);cursor:pointer;display:flex;align-items:flex-start;gap:10px;">
                    
                    <!-- δ��ɫ��ռλ - ����״̬������3px�ռ䱣֤���� -->
                    <span style="width:3px;height:100%;min-height:20px;flex-shrink:0;${showUnreadBar ? 'background:var(--b3-theme-primary);' : 'background:transparent;'}border-radius:2px;align-self:stretch;margin-top:auto;margin-bottom:auto;"></span>
                    
                    <!-- ����ͼ������У� -->
                    ${thumbnailUrl ? `<img src="${thumbnailUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;background:var(--b3-theme-surface-lighter);" loading="lazy" onerror="this.style.display='none'">` : ''}
                    
                    <!-- ��������� -->
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
                �� ${this.i18n.loadMore} (${this.currentArticles.length - end})
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
        };

        articleList.addEventListener("scroll", this.listScrollHandler);
    }

    // Fix #4: Watch SiYuan theme changes
    private watchThemeChanges(container: HTMLElement) {
        this.themeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "attributes" && mutation.attributeName === "data-theme") {
                    const theme = document.body.getAttribute("data-theme");
                    logger.log("Theme changed to:", theme);
                    // CSS variables handle the actual theming, no JS needed
                }
            }
        });
        this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    }

    // Fix #5: Check if article list is full and auto-load more
    private checkAndLoadMore(container: HTMLElement) {
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
                    // Don't recursively call checkAndLoadMore - just reset counter
                    if (this.displayedArticleCount >= this.currentArticles.length) {
                        this.autoLoadRetryCount = 0;
                    }
                }, 150);
            } else {
                // Reset counter when condition is met or no more articles
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

        // Mark as read (if needed) - debounced save
        if (this.settings.autoMarkRead && !article.isRead) {
            article.isRead = true;
            this.readStatus[article.id] = { isRead: true, readAt: Date.now() };
            
            // Debounce save operations to prevent excessive writes
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
            }
            this.saveDebounceTimer = this.safeSetTimeout(async () => {
                try {
                    await this.saveData(READ_STATUS_NAME, this.readStatus);
                    await this.cacheArticles(article.subscriptionId, this.currentArticles);
                } catch (error) {
                    logger.error("Failed to save read status:", error);
                }
            }, 500); // Wait 500ms before saving
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
                            ${this.i18n.originalLink} �J                        </a>
                    </div>
                </div>
                <button class="save-to-siyuan-btn" data-article-id="${article.id}" title="${this.i18n.saveNote}" aria-label="${this.i18n.saveNote}">
                    <svg class="block__logoicon" style="width:24px;height:24px;color:inherit;"><use xlink:href="#iconRSSSave"></use></svg>
                </button>
            </div>
            <div style="max-width:780px;margin:0 auto;padding:20px;">
                <div style="line-height:1.8;color:var(--b3-font-color);font-size:${fontSize.content};">
                    ${this.sanitizeHTMLForDisplay(article.content || article.description)}
                </div>
            </div>`;

        // Fix #2: Scroll to top when opening article
        contentEl.scrollTop = 0;

        // Fix: Use event delegation to avoid closure memory leak
        // Store current article in a weak reference instead of capturing in closure
        const saveBtn = contentEl.querySelector(".save-to-siyuan-btn") as HTMLButtonElement;
        if (saveBtn) {
            // Use onclick with ID lookup instead of capturing entire article object
            saveBtn.onmouseenter = () => {
                saveBtn.style.transform = "scale(1.1)";
                saveBtn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
            };
            saveBtn.onmouseleave = () => {
                saveBtn.style.transform = "scale(1)";
                saveBtn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
            };
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
        const response = await fetchSyncPost("/api/network/forwardProxy", {
            url: url,
            method: "GET",
            timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SiYuan RSS Reader 2.1)" }
        });

        if (response.code !== 0) {
            throw new Error(`API error: ${response.msg || 'unknown'}`);
        }

        if (response.data?.status >= 400) {
            throw new Error(`HTTP ${response.data.status}`);
        }

        const xml: string = response.data?.body || "";
        if (!xml) {
            throw new Error("Empty response");
        }

        // Detect HTML/captcha responses instead of XML
        const trimmed = xml.trimStart();
        if (trimmed.startsWith("<html") || trimmed.startsWith("<!DOCTYPE")) {
            console.error("[RSS] Got HTML page instead of RSS (likely anti-bot/captcha):", xml.substring(0, 300));
            throw new Error(this.i18n.htmlNotRss);
        }

        logger.log("Response preview:", xml.substring(0, 500));

        // Parse RSS/Atom XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");

        const parseError = doc.querySelector("parsererror");
        if (parseError) {
            console.error("[RSS] XML parse error:", parseError.textContent?.substring(0, 300));
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

        // ���ȳ��� innerHTML
        let html = el.innerHTML || "";

        // innerHTML Ϊ��ʱ��textContent ���ܰ���ʵ�����ݣ���CDATA���ı���
        const textContent = el.textContent || "";
        if (!html || html.length < textContent.length) {
            html = textContent;
        }

        // �����������HTML�� innerHTML Ϊ�գ����Զ���DOM����
        if ((!html || html === textContent) && textContent.includes("<") && textContent.includes(">")) {
            try {
                const temp = document.createElement("div");
                temp.innerHTML = textContent;
                const parsed = temp.innerHTML;
                if (parsed && parsed.length > html.length) {
                    html = parsed;
                }
            } catch {
                // ���ν���ʧ�ܣ�����ԭֵ
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
                
            return {
                ...item,
                id: this.generateArticleId(item.link),
                subscriptionId: sub.id,
                isRead: this.readStatus[this.generateArticleId(item.link)]?.isRead || false,
                cachedAt: Date.now(),
                thumbnail: thumbnailUrl || undefined // Only set if found
            } as Article;
        });
    
        const merged = this.mergeArticles(newArticles, cached);
        await this.cacheArticles(sub.id, merged);
            
        // Update last background fetch time
        this.lastBackgroundFetchTime.set(sub.id, Date.now());
            
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
            .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
            .slice(0, MAX_CACHED_ARTICLES);
    }

    private async getCachedArticles(subId: string): Promise<Article[]> {
        const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
        return cached[subId] || [];
    }

    private async cacheArticles(subId: string, articles: Article[]) {
        try {
            // Keep only the latest MAX_CACHED_ARTICLES
            const trimmed = articles.slice(0, MAX_CACHED_ARTICLES);
            const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
            cached[subId] = trimmed;
            await this.saveData(CACHED_ARTICLES_NAME, cached);
        } catch (error) {
            logger.error("Failed to cache articles:", error);
        }
    }

    private getSubscriptionName(subId: string): string {
        return this.subscriptions.find(s => s.id === subId)?.name || subId;
    }

    // ==================== Actions ====================

    private async markAllRead(container: HTMLElement) {
        if (this.currentArticles.length === 0) return;
        for (const a of this.currentArticles) {
            a.isRead = true;
            this.readStatus[a.id] = { isRead: true, readAt: Date.now() };
        }
        await this.saveData(READ_STATUS_NAME, this.readStatus);
        if (this.currentSubscriptionIndex >= 0) {
            await this.cacheArticles(this.subscriptions[this.currentSubscriptionIndex].id, this.currentArticles);
        }
        this.renderArticleList(container, false);
        const countEl = container.querySelector("#articleCount") as HTMLElement;
        if (countEl) countEl.textContent = `${this.currentArticles.length}`;
        showMessage(this.i18n.markAllReadSuccess, 2000);
    }

    // ��ǵ�������ԴΪ�Ѷ�
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
                    this.readStatus[a.id] = { isRead: true, readAt: Date.now() };
                    markedCount++;
                }
            }
            
            await this.saveData(READ_STATUS_NAME, this.readStatus);
            await this.cacheArticles(sub.id, articles);
            
            showMessage(`${this.i18n.markAllReadSuccess} (${markedCount})`, 2000);
            
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

    // ˢ�µ�������Դ
    private async refreshSubscription(index: number, container: HTMLElement) {
        if (index < 0 || index >= this.subscriptions.length) return;
        
        showMessage(this.i18n.refreshing, 1000);
        
        try {
            const sub = this.subscriptions[index];
            await this.fetchAndCacheArticles(sub);
            
            showMessage(this.i18n.refreshSuccess, 1500);
            
            // �����ǰѡ�е����������Դ��ˢ����ʾ
            if (this.currentSubscriptionIndex === index && this.container) {
                this.selectSubscription(index, this.container);
            }
        } catch (error) {
            showMessage(`${this.i18n.refreshFailed}: ${error}`);
        }
    }

    private async refreshCurrentFeed(container: HTMLElement) {
        if (this.currentSubscriptionIndex < 0) return;
        showMessage(this.i18n.refreshing, 1500);
        await this.selectSubscription(this.currentSubscriptionIndex, container);
        showMessage(this.i18n.refreshSuccess, 1500);
    }

    // �������µ�˼Դ�����û�ѡ��Ŀ��ʼǱ�
    private async saveArticleToSiYuan(article: Article) {
        try {
            // ��ȡ�ʼǱ��б�
            const notebooks = await fetchSyncPost("/api/notebook/lsNotebooks", {});
            const allNotebooks = notebooks.data?.notebooks || [];
            const openNotebooks = allNotebooks.filter((nb: any) => !nb.closed);

            if (!openNotebooks.length) {
                showMessage(this.i18n.noOpenNotebook, 3000);
                return;
            }

            // �����ʼǱ�ѡ��Ի���
            const targetNbId = await this.showNotebookSelectionDialog(openNotebooks);
            if (!targetNbId) return; // �û�ȡ��ѡ��

            let fileName = article.title
                .replace(/[/\\:*?"<>|]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 180);
            if (!fileName) fileName = `RSS_${Date.now()}`;

            // ����ͼƬ���Ű棺ʹ�� htmlToMarkdown ת����֧�� img/strong/em/links �ȣ�
            const articleHTML = article.content || article.description || "";
            logger.log("Save article:", article.title, "contentLen:", article.content?.length, "descLen:", article.description?.length, "htmlLen:", articleHTML.length);
            logger.log("Content preview (first 500):", articleHTML.substring(0, 500));
            const articleMarkdown = this.htmlToMarkdown(articleHTML);
            logger.log("Markdown length:", articleMarkdown.length, "preview (first 500):", articleMarkdown.substring(0, 500));

            // Ԫ��Ϣ��
            let metaLines: string[] = [];
            if (article.pubDate) {
                metaLines.push(`> ${this.i18n.publishedAt} ${new Date(article.pubDate).toLocaleString()}`);
            }
            if (article.link) {
                metaLines.push(`> [ԭ������](${article.link})`);
            }

            // �������� Markdown��һ����д�룬���� insertBlock �������⣩
            const fullMd = [
                `# ${fileName}`,
                ...metaLines,
                "",
                articleMarkdown
            ].join("\n");

            showMessage(`${this.i18n.savingTo}��${openNotebooks.find((n: any) => n.id === targetNbId)?.name || ""}����`, 2000);

            logger.log("Full markdown length:", fullMd.length, "preview:", fullMd.substring(0, 300));

            // Step 1: �����ĵ���һ����д��ȫ�����ݣ�
            const res = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: targetNbId,
                path: `/${fileName}`,
                markdown: fullMd
            });
            logger.log("Create doc response:", JSON.stringify(res).substring(0, 500));

            if (res.code === 201 || res.code === 202) {
                // �ļ��Ѵ��ڣ���Ψһ��������
                const uniqueName = `${fileName}_${Date.now().toString(36)}`;
                const res2 = await fetchSyncPost("/api/filetree/createDocWithMd", {
                    notebook: targetNbId,
                    path: `/${uniqueName}`,
                    markdown: fullMd.replace(`# ${fileName}`, `# ${uniqueName}`)
                });
                if (!res2.data) {
                    showMessage(`${this.i18n.saveFailed}��${this.i18n.docExists}`, 3000);
                    return;
                }
            } else if (!res.data) {
                showMessage(`${this.i18n.saveFailed}��${this.i18n.docCreateFailed}`, 3000);
                return;
            }

            const docId = res.data;

            // Step 2: ˢ������
            await fetchSyncPost("/api/sqlite/flushTransaction", {}).catch(() => {});

            // Step 3: ת��Զ��ͼƬΪ������Դ���ο��ٷ� siyuan-chrome��
            if (docId) {
                fetchSyncPost("/api/format/netImg2LocalAssets", {
                    id: docId,
                    url: article.link || ""
                }).catch(() => {}); // ��Ĭʧ�ܣ���Ӱ�챣��
            }

            // Step 4: ��¼����ʹ�õıʼǱ�
            this.settings.lastUsedNotebookId = targetNbId;
            await this.saveSettings();

            logger.log("Save complete:", fileName);
            showMessage(`${this.i18n.saved}��${fileName}`, 4000);

        } catch (error) {
            console.error("[RSS] Save error:", error);
            showMessage(`${this.i18n.saveFailed}��${error}`, 3000);
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
                // Fix: ʹ����ȷ�� markdown �����ʽ # ǰ��
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
                return src ? (`![${alt}](${src})\n`) : "";
            }
            case "ul":
            case "ol": {
                let result = "\n";
                Array.from(el.children).forEach((child) => {
                    if (child.tagName.toLowerCase() === "li") {
                        const inner = this._nodeToMarkdown(child, depth + 1).trim();
                        result += `- ${inner}\n`;
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
                // Skip table structure - extract plain text to avoid malformed table markdown
                const rows: string[] = [];
                el.querySelectorAll("tr").forEach((tr) => {
                    const cells: string[] = [];
                    tr.querySelectorAll("td, th").forEach((td) => {
                        cells.push(this._nodeToMarkdown(td, depth + 1).trim().replace(/\|/g, " / "));
                    });
                    if (cells.length > 0) rows.push(cells.join(" | "));
                });
                if (rows.length === 0) return "";
                // Build proper markdown table with separator row
                const colCount = (rows[0]?.match(/\|/g) || []).length + 1;
                const sep = Array(colCount).fill("---").join(" | ");
                return "\n" + rows.join("\n") + "\n" + sep + "\n\n";
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
    }

    private async checkForUpdates() {
        if (this.subscriptions.length === 0) return;
        let count = 0;
        for (const sub of this.subscriptions) {
            try {
                const feed = await this.fetchAndParseRSS(sub.url);
                if (feed.items?.length > 0 && feed.items[0].pubDate) {
                    const latest = new Date(feed.items[0].pubDate).getTime();
                    if (latest > (sub.lastFetchTime || 0)) {
                        count++;
                        sub.lastFetchTime = Date.now();
                    }
                }
            } catch (e) {
                // Silent fail during background checks
            }
        }
        if (count > 0) showMessage(`${this.i18n.newArticles}: ${count}`, 3000);
        await this.saveData(STORAGE_NAME, this.subscriptions);
    }

    private setupAutoRefresh(container: HTMLElement) {
        if (this.updateInterval) { clearInterval(this.updateInterval); this.updateInterval = null; }
        if (this.settings.autoRefreshInterval > 0) {
            this.updateInterval = setInterval(() => {
                if (this.container) this.refreshAllFeeds(this.container);
            }, this.settings.autoRefreshInterval * 60 * 1000);
        }
    }

    private async refreshAllFeeds(container: HTMLElement) {
        showMessage(this.i18n.refreshing, 2000);
        for (const sub of this.subscriptions) {
            try { await this.fetchAndCacheArticles(sub); }
            catch (e) { /* silent */ }
        }
        if (this.currentSubscriptionIndex >= 0)
            this.selectSubscription(this.currentSubscriptionIndex, container);
        showMessage(this.i18n.refreshSuccess, 2000);
    }

    // ==================== Dialogs ====================

    // �ʼǱ�ѡ��Ի���
    private async showNotebookSelectionDialog(notebooks: any[]): Promise<string | null> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: `?? ${this.i18n.selectNotebook || 'ѡ��ʼǱ�'}`,
                content: `<div class="b3-dialog__content" style="padding:16px;">
                    <div style="margin-bottom:12px;font-size:13px;color:var(--b3-font-color-tertiary);">${this.i18n.selectSaveLocation || '��ѡ�񱣴�λ��'}</div>
                    <div style="display:flex;align-items:center;gap:12px;">
                        <select class="b3-select fn__block" id="notebookSelect" style="font-size:14px;flex:1;">
                            ${notebooks.map((nb, index) => 
                                `<option value="${nb.id}" ${index === 0 ? 'selected' : ''}>${nb.name}</option>`
                            ).join('')}
                        </select>
                        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap;">
                            <input type="checkbox" class="b3-switch" id="rememberNotebook" checked>
                            ${this.i18n.rememberChoice || '��סѡ��'}
                        </label>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button type="button" class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                    <div class="fn__space"></div>
                    <button type="button" class="b3-button b3-button--text" id="confirmNotebook">${this.i18n.confirm}</button>
                </div>`,
                width: "400px",
            });
            requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });

            (dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => {
                dialog.destroy();
                resolve(null);
            };

            dialog.element.querySelector("#confirmNotebook")?.addEventListener("click", () => {
                const select = dialog.element.querySelector("#notebookSelect") as HTMLSelectElement;
                const remember = (dialog.element.querySelector("#rememberNotebook") as HTMLInputElement).checked;
                const notebookId = select.value;
                
                if (remember) {
                    this.settings.lastUsedNotebookId = notebookId;
                    this.saveSettings();
                }
                
                dialog.destroy();
                resolve(notebookId);
            });
        });
    }

    private showHelpDialog() {
        const dialog = new Dialog({
            title: `?? ${this.i18n.helpTitle}`,
            content: `<div class="b3-dialog__content" style="padding:16px;font-size:13px;">
                <div style="display:grid;grid-template-columns:60px 1fr;gap:10px;">
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">J/K</kbd></div><div>${this.i18n.helpPrevNext}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">O</kbd></div><div>${this.i18n.helpOpenOriginal}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">S</kbd></div><div>${this.i18n.helpSaveToSiYuan}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">R</kbd></div><div>${this.i18n.helpRefreshFeed}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">A</kbd></div><div>${this.i18n.helpMarkAllRead}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">?</kbd></div><div>${this.i18n.helpShowHelp}</div>
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--text" onclick="this.closest('.b3-dialog').remove()">OK</button>
            </div>`,
            width: "360px",
        });
        requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });
    }

    private showSettingsDialog(container: HTMLElement) {
        const dialog = new Dialog({
            title: `? ${this.i18n.settings}`,
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
            this.setupAutoRefresh(container);
            
            // Re-render entire UI to apply layout and font changes
            // initSidebarUI will rebuild all DOM and rebind events
            
            // Reset selection state to force reload after UI rebuild
            const savedIndex = this.currentSubscriptionIndex;
            this.currentSubscriptionIndex = -1;
            
            this.initSidebarUI(container);
            
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
        // Block elements �� newlines
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
        // Fix: ���ٸ� img �������� style���ᵼ��˼Դ AST ����������
        c = c.replace(/<img(?![^>]*loading=)/gi, '<img loading="lazy" ');
        return c;
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
        const lang = window.siyuan?.config?.lang || 'en_US';
        const locale = lang.replace('_', '-');
        return date.toLocaleDateString(locale);
    }
}


