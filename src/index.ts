﻿﻿﻿﻿﻿import {
    Plugin,
    showMessage,
    Dialog,
    fetchSyncPost,
} from "siyuan";

import "./index.scss";

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

interface Settings {
    articlesPerPage: number;
    autoMarkRead: boolean;
    layout: {
        sidebarWidth: number;
        listHeightRatio: number;
    };
    enableKeyboardShortcuts: boolean;
    showUnreadOnly: boolean;
    fontSize: 'small' | 'medium' | 'large';
    autoRefreshInterval: number;
    lastUsedNotebookId?: string;
}

const defaultSettings: Settings = {
    articlesPerPage: DEFAULT_ARTICLES_PER_PAGE,
    autoMarkRead: true,
    layout: {
        sidebarWidth: 20,
        listHeightRatio: 40
    },
    enableKeyboardShortcuts: true,
    showUnreadOnly: false,
    fontSize: 'medium',
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
    SEARCH: '/',
    ESCAPE: 'Escape',
    HELP: '?'
};

// ✅Default feeds - all tested working in China (2026-04-20)
const FEATURED_FEEDS = [
    // 中文科技/设计
    { name: "少数派", url: "https://sspai.com/feed" },
    { name: "爱范儿", url: "https://www.ifanr.com/feed/" },
    { name: "优设", url: "https://www.uisdc.com/feed" },
    { name: "钛媒体", url: "https://www.tmtpost.com/feed" },
    { name: "煎蛋", url: "https://jandan.net/rss" },
    { name: "机核网", url: "https://www.gcores.com/rss" },
    { name: "数字尾巴", url: "https://www.digitaling.com/rss" },
    // 国际科技
    { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml" },
    { name: "arXiv AI", url: "https://rss.arxiv.org/rss/cs.AI" },
    { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
];

export default class RSSReaderPlugin extends Plugin {
    private subscriptions: Subscription[] = [];
    private settings: Settings = defaultSettings;
    private currentSubscriptionIndex: number = -1;
    private currentPage: number = 0;
    private displayedArticleCount: number = 0; // For infinite scroll
    private currentArticles: Article[] = [];
    private readStatus: ReadStatus = {};
    private currentArticleIndex: number = -1;
    private searchQuery: string = "";
    private isSearchMode: boolean = false;
    private container: HTMLElement | null = null;
    private dockInstance: any = null; // Store dock instance for toggle/minimize
    private updateInterval: NodeJS.Timeout | null = null;
    private boundHandleKeyboard!: (e: KeyboardEvent) => void;
    private listScrollHandler!: () => void;
    private isLoadingMore: boolean = false;
    // Resizer cleanup refs
    private resizerMoveHandler: ((e: MouseEvent) => void) | null = null;
    private resizerUpHandler: (() => void) | null = null;
    private vResizerMoveHandler: ((e: MouseEvent) => void) | null = null;
    private vResizerUpHandler: (() => void) | null = null;

    async onload() {
        console.log("RSS Reader Plugin loaded v2.1");

        await this.loadSettings();
        
        // Fix #3: Auto-detect SiYuan language setting
        this.detectLanguage();

        const data = await this.loadData(STORAGE_NAME);
        this.subscriptions = data || [];

        // Migration: remove 36kr (anti-bot blocks it) from saved subscriptions
        const before = this.subscriptions.length;
        this.subscriptions = this.subscriptions.filter(s => !s.url.includes("36kr.com"));
        if (this.subscriptions.length < before) {
            console.log("[RSS] Migration: removed 36kr from subscriptions");
            await this.saveData(STORAGE_NAME, this.subscriptions);
        }

        const status = await this.loadData(READ_STATUS_NAME);
        this.readStatus = status || {};

        this.boundHandleKeyboard = this.handleKeyboard.bind(this);

        this.addIcons(`<symbol id="iconRSS" viewBox="0 0 32 32">
<path d="M5.333 22.667c-1.473 0-2.667 1.194-2.667 2.667s1.194 2.667 2.667 2.667 2.667-1.194 2.667-2.667-1.194-2.667-2.667-2.667zM2.667 2.667v2.667c12.519 0 22.667 10.148 22.667 22.667h2.667c0-13.991-11.343-25.333-25.333-25.333zM2.667 12v2.667c7.363 0 13.333 5.97 13.333 13.333h2.667c0-8.837-7.163-16-16-16z"></path>
</symbol>`);

        this.addTopBar({
            icon: "iconRSS",
            title: this.i18n.rssReader,
            position: "right",
            callback: () => {
                this.openRSSReader();
            }
        });

        const plugin = this;
        this.addDock({
            type: "rss_reader_dock",
            config: {
                position: "RightBottom",
                size: { width: 400, height: 300 },
                icon: "iconRSS",
                title: this.i18n.rssReader
            },
            data: {},
            init: function (this: any, dock: any) {
                try {
                    plugin.container = this.element;
                    plugin.dockInstance = dock;
                    plugin.initSidebarUI(this.element);
                    // Toolbar is now built into the title bar (initSidebarUI), no need for separate dock header injection
                } catch (err) {
                    console.error("[RSS] Dock init error:", err);
                }
            }
        });

        this.startScheduledUpdates();
        this.registerKeyboardShortcuts();
    }

    ondestroy() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        document.removeEventListener('keydown', this.boundHandleKeyboard);
        // Cleanup global resizer event listeners
        if (this.resizerMoveHandler) document.removeEventListener('mousemove', this.resizerMoveHandler);
        if (this.resizerUpHandler) document.removeEventListener('mouseup', this.resizerUpHandler);
        if (this.vResizerMoveHandler) document.removeEventListener('mousemove', this.vResizerMoveHandler);
        if (this.vResizerUpHandler) document.removeEventListener('mouseup', this.vResizerUpHandler);
        if (this.container) {
            const articleList = this.container.querySelector("#rssArticleList");
            if (articleList && this.listScrollHandler) {
                articleList.removeEventListener("scroll", this.listScrollHandler);
            }
        }
    }

    private async loadSettings() {
        const saved = await this.loadData(SETTINGS_NAME);
        this.settings = { ...defaultSettings, ...saved };
    }

    // Fix #3: Detect SiYuan language and set locale
    private detectLanguage() {
        try {
            // @ts-ignore
            const lang = window.siyuan?.config?.lang || "en_US";
            // SiYuan's i18n is handled by the plugin system based on lang
            // We don't need to manually switch - it's automatic
            console.log("[RSS] Detected language:", lang);
        } catch (e) {
            console.warn("[RSS] Failed to detect language:", e);
        }
    }

    private async saveSettings() {
        await this.saveData(SETTINGS_NAME, this.settings);
    }

    private registerKeyboardShortcuts() {
        if (!this.settings.enableKeyboardShortcuts) return;
        document.addEventListener('keydown', this.boundHandleKeyboard);
    }

    private handleKeyboard(e: KeyboardEvent) {
        if (!this.container || !this.settings.enableKeyboardShortcuts) return;
        if ((e.target as HTMLElement).tagName === 'INPUT' ||
            (e.target as HTMLElement).tagName === 'TEXTAREA' ||
            (e.target as HTMLElement).tagName === 'SELECT') {
            if (e.key === SHORTCUTS.ESCAPE) {
                (e.target as HTMLElement).blur();
                this.exitSearchMode();
            }
            return;
        }

        switch (e.key.toLowerCase()) {
            case SHORTCUTS.NEXT_ARTICLE: e.preventDefault(); this.navigateArticle(1); break;
            case SHORTCUTS.PREV_ARTICLE: e.preventDefault(); this.navigateArticle(-1); break;
            case SHORTCUTS.OPEN_ORIGINAL: e.preventDefault(); this.openCurrentArticleOriginal(); break;
            case SHORTCUTS.SAVE_TO_SIYUAN: e.preventDefault(); this.saveCurrentArticle(); break;
            case SHORTCUTS.REFRESH: e.preventDefault(); if (this.container) this.refreshCurrentFeed(this.container); break;
            case SHORTCUTS.MARK_ALL_READ: e.preventDefault(); if (this.container) this.markAllRead(this.container); break;
            case SHORTCUTS.SEARCH: e.preventDefault(); this.focusSearchInput(); break;
            case SHORTCUTS.HELP: e.preventDefault(); this.showHelpDialog(); break;
            case SHORTCUTS.ESCAPE: this.exitSearchMode(); break;
        }
    }

    // Get font size CSS value based on settings
    private getFontSizeStyle(): { content: string; title: string; meta: string } {
        switch (this.settings.fontSize) {
            case 'small': return { content: '13px', title: '15px', meta: '10px' };
            case 'large': return { content: '16px', title: '18px', meta: '12px' };
            default: return { content: '14px', title: '16px', meta: '11px' };
        }
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

    private focusSearchInput() {
        if (!this.container) return;
        const input = this.container.querySelector("#searchInput") as HTMLInputElement;
        if (input) { input.focus(); this.isSearchMode = true; }
    }

    private exitSearchMode() {
        if (!this.isSearchMode) return;
        this.isSearchMode = false;
        this.searchQuery = "";
        if (this.container) {
            const input = this.container.querySelector("#searchInput") as HTMLInputElement;
            if (input) { input.value = ""; input.blur(); }
            if (this.currentSubscriptionIndex >= 0) {
                this.selectSubscription(this.currentSubscriptionIndex, this.container);
            }
        }
    }

    // ==================== UI ====================

    // SVG icon helpers
    private svgIcon(path: string, size = 16): string {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    }

    private initSidebarUI(container: HTMLElement) {
        const sw = this.settings.layout.sidebarWidth;
        const lh = this.settings.layout.listHeightRatio;

        container.innerHTML = `
            <div style="width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative;">
                <!-- Title bar with toolbar buttons -->
                <div id="rssTitleBar" style="flex-shrink:0;display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid var(--b3-border-color);background:var(--b3-theme-surface);min-height:32px;">
                    <svg style="width:16px;height:16px;flex-shrink:0;margin-right:6px;"><use xlink:href="#iconRSS"></use></svg>
                    <span style="font-size:13px;font-weight:600;color:var(--b3-font-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">RSS Reader</span>
                    <div style="flex:1;"></div>
                    <!-- Toolbar buttons (right side) -->
                    <button id="tbAdd" title="${this.i18n.add}" style="width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color2);"><svg style="width:15px;height:15px;"><use xlink:href="#iconAdd"></use></svg></button>
                    <button id="tbRefresh" title="${this.i18n.refresh} (R)" style="width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color2);"><svg style="width:15px;height:15px;"><use xlink:href="#iconRefresh"></use></svg></button>
                    <button id="tbMarkRead" title="${this.i18n.markAllRead} (A)" style="width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color2);"><svg style="width:15px;height:15px;"><use xlink:href="#iconCheck"></use></svg></button>
                    <button id="tbSettings" title="${this.i18n.settings}" style="width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color2);"><svg style="width:15px;height:15px;"><use xlink:href="#iconSettings"></use></svg></button>
                    <button id="tbHelp" title="${this.i18n.help} (?)" style="width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color2);"><svg style="width:15px;height:15px;"><use xlink:href="#iconHelp"></use></svg></button>
                    <button id="tbMinimize" title="Minimize" style="width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--b3-font-color2);"><svg style="width:14px;height:14px;"><use xlink:href="#iconMin"></use></svg></button>
                </div>
                <!-- Content area below title bar -->
                <div style="flex:1;display:flex;overflow:hidden;">
                    <!-- Left: subscription sidebar -->
                    <div id="rssSidebar" style="width:${sw}%;min-width:130px;max-width:35%;border-right:1px solid var(--b3-border-color);display:flex;flex-direction:column;background:var(--b3-theme-surface);flex-shrink:0;">
                        <div id="rssList" style="flex:1;overflow-y:auto;padding:4px;">
                            ${this.renderSubscriptionListHTML()}
                        </div>
                    </div>
                    <!-- Horizontal resizer -->
                    <div id="rssResizer" style="width:4px;background:var(--b3-border-color);cursor:col-resize;flex-shrink:0;"></div>
                    <!-- Right: article list + content -->
                    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
                        <div id="rssArticleList" style="flex:0 0 ${lh}%;min-height:80px;border-bottom:1px solid var(--b3-border-color);overflow-y:auto;background:var(--b3-theme-background);">
                            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">
                                ${this.i18n.selectArticle}
                            </div>
                        </div>
                        <div id="rssVerticalResizer" style="height:4px;background:var(--b3-border-color);cursor:row-resize;flex-shrink:0;"></div>
                        <div id="rssArticleContent" style="flex:1;overflow-y:auto;background:var(--b3-theme-background);">
                            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-font-color-quaternary);font-size:13px;">
                                ${this.i18n.selectArticle}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

        this.setupEventListeners(container);
        // ✅Fix #5: Setup infinite scroll
        this.setupInfiniteScroll(container);
    }

    private setupEventListeners(container: HTMLElement) {
        // Bind title bar toolbar buttons
        const bind = (id: string, fn: () => void) => {
            container.querySelector('#' + id)?.addEventListener('click', fn);
        };
        bind('tbAdd', () => this.showAddSubscriptionDialog(container));
        bind('tbRefresh', () => this.refreshCurrentFeed(container));
        bind('tbMarkRead', () => this.markAllRead(container));
        bind('tbSettings', () => this.showSettingsDialog(container));
        bind('tbHelp', () => this.showHelpDialog());
        bind('tbMinimize', () => this.toggleMinimize());

        // Hover effect for toolbar buttons
        container.querySelectorAll('#rssTitleBar button').forEach(btn => {
            btn.addEventListener('mouseenter', () => (btn as HTMLElement).style.background = 'var(--b3-theme-background)');
            btn.addEventListener('mouseleave', () => (btn as HTMLElement).style.background = 'transparent');
        });

        this.setupSubscriptionEvents(container);
        this.setupResizerEvents(container);
    }

    private renderSubscriptionListHTML(): string {
        if (this.subscriptions.length === 0) {
            return `<div style="padding:16px;color:var(--b3-font-color-quaternary);text-align:center;font-size:12px;">
                <div style="font-size:24px;margin-bottom:8px;opacity:0.6;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg></div>
                <div>${this.i18n.noSubscriptions}</div>
                <div style="margin-top:4px;font-size:11px;">${this.i18n.addFirst}</div>
            </div>`;
        }
        return this.subscriptions.map((sub, index) => `
            <div class="rss-item ${this.currentSubscriptionIndex === index ? 'active' : ''}"
                data-index="${index}"
                style="padding:8px 10px;border-radius:4px;margin-bottom:2px;cursor:pointer;transition:all 0.15s;display:flex;justify-content:space-between;align-items:center;gap:6px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:${this.currentSubscriptionIndex === index ? '500' : '400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--b3-font-color);">
                        ${sub.name || sub.url}
                    </div>
                </div>
                <button class="delete-rss" data-index="${index}" style="opacity:0;padding:2px 4px;border:none;background:transparent;cursor:pointer;color:var(--b3-font-color-quaternary);border-radius:3px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        `).join("");
    }

    private setupSubscriptionEvents(container: HTMLElement) {
        container.querySelectorAll(".rss-item").forEach(item => {
            item.addEventListener("mouseenter", () => {
                if (!item.classList.contains("active")) {
                    (item as HTMLElement).style.backgroundColor = "var(--b3-list-hover)";
                }
                const del = item.querySelector(".delete-rss") as HTMLElement;
                if (del) del.style.opacity = "1";
            });
            item.addEventListener("mouseleave", () => {
                if (!item.classList.contains("active")) {
                    (item as HTMLElement).style.backgroundColor = "transparent";
                }
                const del = item.querySelector(".delete-rss") as HTMLElement;
                if (del) del.style.opacity = "0";
            });
            item.addEventListener("click", (e) => {
                if ((e.target as HTMLElement).closest(".delete-rss")) return;
                const index = parseInt((e.currentTarget as HTMLElement).dataset.index!);
                this.selectSubscription(index, container);
            });
        });

        container.querySelectorAll(".delete-rss").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = parseInt((e.currentTarget as HTMLElement).dataset.index!);
                this.deleteSubscription(index, container);
            });
        });
    }

    // ==================== Resizer ====================

    // Add toolbar buttons to dock header (top-right, like Graph View)
    private addToolbarToDockHeader(container: HTMLElement) {
        // Wait for dock to be fully rendered
        setTimeout(() => {
            this.doAddToolbarToDockHeader(container);
        }, 100);
    }

    private doAddToolbarToDockHeader(container: HTMLElement) {
        // Find the dock panel by data-type
        const dockPanel = document.querySelector('[data-type="rss_reader_dock"]') as HTMLElement;
        if (!dockPanel) {
            console.warn('[RSS] Dock panel not found for toolbar');
            return;
        }

        // Debug: dump dock DOM structure
        console.log('[RSS] Dock panel tagName:', dockPanel.tagName, 'className:', dockPanel.className, 'children:', dockPanel.children.length);
        Array.from(dockPanel.children).forEach((child, i) => {
            const el = child as HTMLElement;
            console.log(`[RSS]   child[${i}]:`, el.tagName, el.className, 'display:', window.getComputedStyle(el).display, 'html:', el.outerHTML.substring(0, 200));
        });

        // SiYuan dock structure: the header is typically the first flex row
        // Look for any element that contains a close button
        let header: HTMLElement | null = null;
        
        // Strategy 1: Find by close button parent
        const closeBtn = dockPanel.querySelector('[data-type="close"]') as HTMLElement;
        if (closeBtn && closeBtn.parentElement) {
            header = closeBtn.parentElement as HTMLElement;
            console.log('[RSS] Found header via close button parent:', header.className);
        }
        
        // Strategy 2: Find by common dock header classes
        if (!header) {
            header = dockPanel.querySelector('.dock__header, .layout__tab--header, [class*="header"]') as HTMLElement | null;
            if (header) console.log('[RSS] Found header via class:', header.className);
        }
        
        // Strategy 3: First non-column flex child
        if (!header) {
            const children = Array.from(dockPanel.children);
            for (const child of children) {
                const el = child as HTMLElement;
                const style = window.getComputedStyle(el);
                if (style.display === 'flex' && !el.classList.contains('fn__flex-column')) {
                    header = el;
                    console.log('[RSS] Found header via flex child:', el.className);
                    break;
                }
            }
        }

        if (!header) {
            console.warn('[RSS] Dock header not found - all strategies failed');
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
                    <use xlink:href="#iconRss"></use>
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
            { id: 'dockAddRSS',       icon: 'iconAdd',      tip: this.i18n.add },
            { id: 'dockRefreshBtn',   icon: 'iconRefresh',   tip: this.i18n.refresh + ' (R)' },
            { id: 'dockMarkAllReadBtn', icon: 'iconCheck',   tip: this.i18n.markAllRead + ' (A)' },
            { id: 'dockSettingsBtn',  icon: 'iconSettings', tip: this.i18n.settings },
            { id: 'dockHelpBtn',      icon: 'iconHelp',     tip: this.i18n.help + ' (?)' },
        ].map(btn =>
            `<button class="b3-tooltips b3-tooltips__sw block__icon" ` +
                    `data-position="southwest" aria-label="${btn.tip}" id="${btn.id}">` +
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

        console.log('[RSS] Toolbar added to dock header:', header.className);

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
        const hResizer = container.querySelector("#rssResizer") as HTMLElement;
        const sidebar = container.querySelector("#rssSidebar") as HTMLElement;

        if (hResizer && sidebar) {
            let startX = 0, startWidth = 0, resizing = false;

            hResizer.addEventListener("mousedown", (e) => {
                e.preventDefault();
                resizing = true;
                startX = e.clientX;
                startWidth = sidebar.offsetWidth;
                hResizer.style.background = "var(--b3-theme-primary)";
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
            });

            const onMove = (e: MouseEvent) => {
                if (!resizing) return;
                const parent = sidebar.parentElement!;
                const pct = ((startWidth + e.clientX - startX) / parent.offsetWidth) * 100;
                if (pct >= 10 && pct <= 35) sidebar.style.width = `${pct}%`;
            };

            const onUp = () => {
                if (!resizing) return;
                resizing = false;
                hResizer.style.background = "";
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                this.settings.layout.sidebarWidth = parseFloat(sidebar.style.width) || this.settings.layout.sidebarWidth;
                this.saveSettings();
            };

            this.resizerMoveHandler = onMove;
            this.resizerUpHandler = onUp;
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        }

        const vResizer = container.querySelector("#rssVerticalResizer") as HTMLElement;
        const articleList = container.querySelector("#rssArticleList") as HTMLElement;

        if (vResizer && articleList) {
            let startY = 0, startPct = 0, resizing = false;

            vResizer.addEventListener("mousedown", (e) => {
                e.preventDefault();
                resizing = true;
                startY = e.clientY;
                const parent = articleList.parentElement!;
                startPct = (articleList.offsetHeight / parent.offsetHeight) * 100;
                vResizer.style.background = "var(--b3-theme-primary)";
                document.body.style.cursor = "row-resize";
                document.body.style.userSelect = "none";
            });

            const onMove = (e: MouseEvent) => {
                if (!resizing) return;
                const parent = articleList.parentElement!;
                const delta = e.clientY - startY;
                const newPct = startPct + (delta / parent.offsetHeight) * 100;
                if (newPct >= 10 && newPct <= 80) articleList.style.flex = `0 0 ${newPct}%`;
            };

            const onUp = () => {
                if (!resizing) return;
                resizing = false;
                vResizer.style.background = "";
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                const parent = articleList.parentElement!;
                const pct = (articleList.offsetHeight / parent.offsetHeight) * 100;
                this.settings.layout.listHeightRatio = pct;
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
        this.currentSubscriptionIndex = index;
        this.currentPage = 0;
        this.displayedArticleCount = 0;
        this.currentArticles = [];
        this.isSearchMode = false;

        const sub = this.subscriptions[index];
        const articleListEl = container.querySelector("#rssArticleList") as HTMLElement;
        const countEl = container.querySelector("#articleCount") as HTMLElement;

        container.querySelectorAll(".rss-item").forEach((item) => {
            const i = parseInt((item as HTMLElement).dataset.index!);
            item.classList.toggle("active", i === index);
            (item as HTMLElement).style.backgroundColor = i === index ? "var(--b3-theme-surface-lighter)" : "transparent";
            (item as HTMLElement).style.borderLeft = i === index ? "3px solid var(--b3-theme-primary)" : "none";
        });

        articleListEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--b3-font-color-quaternary);font-size:13px;">
            <div class="fn__loading" style="margin:0 auto;"></div>
            <div style="margin-top:8px;">${this.i18n.loading}</div>
        </div>`;

        try {
            const articles = await this.fetchAndCacheArticles(sub);
            this.currentArticles = articles;
            this.displayedArticleCount = 0;
            if (countEl) {
                const unread = articles.filter(a => !a.isRead).length;
                countEl.textContent = unread > 0 ? `${unread}/${articles.length}` : `${articles.length}`;
            }
            this.renderArticleList(container);
            // Fix #5: Auto-load more if list doesn't fill the container
            setTimeout(() => this.checkAndLoadMore(container), 100);
        } catch (error) {
            console.error("Failed to fetch RSS:", error);
            const msg = error instanceof Error ? error.message : String(error);
            articleListEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--b3-theme-error);font-size:13px;">
                ❌${this.i18n.networkError}: ${msg}
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
                    <button class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                    <div class="fn__space"></div>
                    <button class="b3-button b3-button--text" id="delConfirm" style="color:var(--b3-theme-error);">${this.i18n.delete}</button>
                </div>`,
                width: "350px",
            });
            // ✅Fix z-index to be above sticky header
            requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });
            dialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => { dialog.destroy(); resolve(false); });
            dialog.element.querySelector("#delConfirm")?.addEventListener("click", () => { dialog.destroy(); resolve(true); });
        });

        if (!confirmed) return;

        this.subscriptions.splice(index, 1);

        if (sub.id) {
            const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
            delete cached[sub.id];
            await this.saveData(CACHED_ARTICLES_NAME, cached);
        }

        await this.saveData(STORAGE_NAME, this.subscriptions);

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
                <button class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                <div class="fn__space"></div>
                <button class="b3-button b3-button--text" id="confirmAdd">${this.i18n.confirm}</button>
            </div>`,
            width: "400px",
        });

        // ✅Fix #4: Ensure dialog is above article content sticky header
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
        const el = container.querySelector("#rssArticleList") as HTMLElement;
        const perPage = this.settings.articlesPerPage;

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
                    <div style="font-size:24px;margin-bottom:8px;opacity:0.6;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg></div>
                    <div>\${this.i18n.noSubscriptions}</div>
                </div>`;
            return;
        }

        const html = page.map((article, i) => {
            const gi = start + i;
            return `
                <div class="article-item ${article.isRead ? 'is-read' : ''} ${this.currentArticleIndex === gi ? 'selected' : ''}"
                    data-index="${gi}"
                    style="padding:10px 14px;border-bottom:1px solid var(--b3-border-color);cursor:pointer;transition:background 0.15s;${article.isRead ? 'opacity:0.55;' : ''} ${this.currentArticleIndex === gi ? 'background-color:var(--b3-list-hover);' : ''}">
                    <div style="font-size:13px;font-weight:${article.isRead ? '400' : '500'};margin-bottom:4px;color:var(--b3-font-color);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                        ${article.isRead ? '' : '<span style="color:var(--b3-theme-primary);margin-right:3px;font-size:10px;">鈼?/span>'}${this.highlightSearchTerm(article.title)}
                    </div>
                    <div style="font-size:11px;color:var(--b3-font-color-tertiary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px;">
                        ${this.highlightSearchTerm(this.stripHTML(article.description || article.content).substring(0, 80))}...
                    </div>
                    <div style="font-size:10px;color:var(--b3-font-color-quaternary);">
                        ${article.pubDate ? this.formatDate(article.pubDate) : ''}
                        ${this.isSearchMode ? ` 路 ${this.getSubscriptionName(article.subscriptionId)}` : ''}
                    </div>
                </div>`;
        }).join("");

        if (append) {
            // Remove only the loading indicator, keep existing articles
            const loadingEl = el.querySelector(".loading-more");
            if (loadingEl) loadingEl.remove();
            // Append new article items before the (now removed) loading indicator
            el.insertAdjacentHTML("beforeend", html);
        } else {
            el.innerHTML = html;
        }

        if (hasMore) {
            el.insertAdjacentHTML("beforeend", `<div class="loading-more" style="padding:12px;text-align:center;color:var(--b3-font-color-quaternary);font-size:12px;">
                鈫?${this.i18n.loadMore} (${this.currentArticles.length - end})
            </div>`);
        }

        this.displayedArticleCount = end;
        this.setupArticleListEvents(container);
    }

    // ✅Fix #5: Infinite scroll - properly append without removing existing items
    private setupInfiniteScroll(container: HTMLElement) {
        const articleList = container.querySelector("#rssArticleList") as HTMLElement;

        this.listScrollHandler = () => {
            // Skip during search mode, when already loading, or no more articles
            if (this.isSearchMode || this.isLoadingMore) return;
            if (this.currentArticles.length === 0) return;

            const { scrollTop, scrollHeight, clientHeight } = articleList;
            if (scrollTop + clientHeight >= scrollHeight - 80) {
                if (this.displayedArticleCount < this.currentArticles.length) {
                    this.isLoadingMore = true;
                    this.renderArticleList(container, true);
                    // Unlock after a short delay to prevent rapid-fire
                    setTimeout(() => { this.isLoadingMore = false; }, 500);
                }
            }
        };

        articleList.addEventListener("scroll", this.listScrollHandler);
    }

    // Fix #4: Watch SiYuan theme changes
    private watchThemeChanges(container: HTMLElement) {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "attributes" && mutation.attributeName === "data-theme") {
                    const theme = document.body.getAttribute("data-theme");
                    console.log("[RSS] Theme changed to:", theme);
                    // CSS variables handle the actual theming, no JS needed
                }
            }
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    }

    // Fix #5: Check if article list is full and auto-load more
    private checkAndLoadMore(container: HTMLElement) {
        const articleList = container.querySelector("#rssArticleList") as HTMLElement;
        if (!articleList || this.currentArticles.length === 0) return;
        
        // Use requestAnimationFrame for accurate DOM measurements
        requestAnimationFrame(() => {
            const { scrollHeight, clientHeight } = articleList;
            // If list doesn't fill the container and there are more articles, load more
            if (scrollHeight <= clientHeight + 10 && this.displayedArticleCount < this.currentArticles.length) {
                console.log("[RSS] Auto-loading more articles (list not full)", { scrollHeight, clientHeight, displayed: this.displayedArticleCount, total: this.currentArticles.length });
                this.isLoadingMore = true;
                this.renderArticleList(container, true);
                // Check again after render
                setTimeout(() => {
                    this.isLoadingMore = false;
                    this.checkAndLoadMore(container);
                }, 150);
            }
        });
    }

    // Toggle minimize/maximize by collapsing the dock panel height
    private isMinimized: boolean = false;
    private savedHeight: string = '';
    
    private toggleMinimize() {
        if (!this.container) {
            console.error("[RSS] container not available");
            return;
        }
        
        // DEBUG: Log the DOM structure to find the correct container
        console.log("[RSS] === MINIMIZE DEBUG ===");
        console.log("[RSS] this.container class:", this.container.className);
        
        // Walk up the DOM tree and log each level
        let current: HTMLElement | null = this.container;
        for (let i = 0; i < 10 && current; i++) {
            current = current.parentElement;
            if (!current) break;
            
            console.log(`[RSS] Level ${i}: tag=${current.tagName}, id=${current.id}, class=${current.className.substring(0, 100)}`);
            
            // Stop at body or html
            if (current.tagName === 'BODY' || current.tagName === 'HTML') break;
        }
        
        console.log("[RSS] === END DEBUG ===");
        console.error("[RSS] Please share the debug output above so I can find the correct container");
    }
    }


    private setupArticleListEvents(container: HTMLElement) {
        container.querySelectorAll(".article-item").forEach(item => {
            item.addEventListener("mouseenter", () => {
                if (!item.classList.contains("selected"))
                    (item as HTMLElement).style.backgroundColor = "var(--b3-list-hover)";
            });
            item.addEventListener("mouseleave", () => {
                if (!item.classList.contains("selected"))
                    (item as HTMLElement).style.backgroundColor = "transparent";
            });
            item.addEventListener("click", () => {
                const index = parseInt((item as HTMLElement).dataset.index!);
                this.currentArticleIndex = index;
                this.selectArticle(index, container);
            });
        });
    }

    private async selectArticle(index: number, container: HTMLElement) {
        const article = this.currentArticles[index];
        if (!article) return;

        if (this.settings.autoMarkRead && !article.isRead) {
            article.isRead = true;
            this.readStatus[article.id] = { isRead: true, readAt: Date.now() };
            await this.saveData(READ_STATUS_NAME, this.readStatus);
            await this.cacheArticles(article.subscriptionId, this.currentArticles);
            this.renderArticleList(container, false);
        }

        const contentEl = container.querySelector("#rssArticleContent") as HTMLElement;
        const fontSize = this.getFontSizeStyle();
        // ✅Fix #2: Sticky header for article with save button always visible
        contentEl.innerHTML = `
            <div style="position:sticky;top:0;z-index:100;background:var(--b3-theme-background);padding:12px 20px 10px;border-bottom:1px solid var(--b3-border-color);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="flex:1;min-width:0;">
                    <h1 style="font-size:${fontSize.title};font-weight:600;color:var(--b3-font-color);line-height:1.4;margin:0 0 6px;word-break:break-word;">
                        ${article.title}
                    </h1>
                    <div style="font-size:${fontSize.meta};color:var(--b3-font-color-quaternary);display:flex;gap:10px;align-items:center;">
                        <span>${article.pubDate ? this.formatDate(article.pubDate) : ''}</span>
                        <a href="${article.link}" target="_blank" style="color:var(--b3-theme-primary);text-decoration:none;display:flex;align-items:center;gap:2px;">
                            原文 ↗                        </a>
                    </div>
                </div>
                <button class="save-to-siyuan-btn" style="flex-shrink:0;width:32px;height:32px;border-radius:50%;border:none;background:var(--b3-theme-primary);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 2px 6px rgba(0,0,0,0.15);" title="${this.i18n.saveToSiYuan}" aria-label="${this.i18n.saveToSiYuan}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
            </div>
            <div style="max-width:780px;margin:0 auto;padding:20px;">
                <div style="line-height:1.8;color:var(--b3-font-color);font-size:${fontSize.content};">
                    ${this.sanitizeHTMLForDisplay(article.content || article.description)}
                </div>
            </div>`;

        // Add hover effect and click handler to save button
        const saveBtn = contentEl.querySelector(".save-to-siyuan-btn") as HTMLButtonElement;
        if (saveBtn) {
            saveBtn.addEventListener("mouseenter", () => {
                saveBtn.style.transform = "scale(1.1)";
                saveBtn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
            });
            saveBtn.addEventListener("mouseleave", () => {
                saveBtn.style.transform = "scale(1)";
                saveBtn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
            });
            saveBtn.addEventListener("click", () => {
                this.saveArticleToSiYuan(article);
            });
        }
    }

    // ==================== RSS Fetching (via forwardProxy) ====================

    private async fetchAndParseRSS(url: string): Promise<{ items: RSSItem[] }> {
        console.log("[RSS] Fetching via proxy:", url);

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
            throw new Error("该源返回了网页而非RSS（可能触发了反爬验证），请尝试其他订阅源锛堝彲鑳借Е鍙戜簡鍙嶇埇楠岃瘉锛夛紝璇峰皾璇曞叾浠栬闃呮簮");
        }

        console.log("[RSS] Response preview:", xml.substring(0, 500));

        // Parse RSS/Atom XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");

        const parseError = doc.querySelector("parsererror");
        if (parseError) {
            console.error("[RSS] XML parse error:", parseError.textContent?.substring(0, 300));
            throw new Error("RSS格式解析失败");
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

                console.log("[RSS] Parsed:", title?.substring(0, 30), "contentLen:", contentHTML.length);

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

        // 优先尝试 innerHTML
        let html = el.innerHTML || "";

        // innerHTML 为空时，textContent 可能包含实际内容（如CDATA或纯文本）
        const textContent = el.textContent || "";
        if (!html || html.length < textContent.length) {
            html = textContent;
        }

        // 如果看起来像HTML但 innerHTML 为空，尝试二次DOM解析
        if ((!html || html === textContent) && textContent.includes("<") && textContent.includes(">")) {
            try {
                const temp = document.createElement("div");
                temp.innerHTML = textContent;
                const parsed = temp.innerHTML;
                if (parsed && parsed.length > html.length) {
                    html = parsed;
                }
            } catch {
                // 二次解析失败，保持原值
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
        const feed = await this.fetchAndParseRSS(sub.url);
        const cached = await this.getCachedArticles(sub.id);

        const newArticles = feed.items.map(item => ({
            ...item,
            id: this.generateArticleId(item.link),
            subscriptionId: sub.id,
            isRead: this.readStatus[this.generateArticleId(item.link)]?.isRead || false,
            cachedAt: Date.now()
        } as Article));

        const merged = this.mergeArticles(newArticles, cached);
        await this.cacheArticles(sub.id, merged);
        return merged;
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
        const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
        cached[subId] = articles;
        await this.saveData(CACHED_ARTICLES_NAME, cached);
    }

    // ==================== Search ====================

    private async handleSearch(query: string, container: HTMLElement) {
        this.searchQuery = query.trim().toLowerCase();
        if (!this.searchQuery) {
            if (this.currentSubscriptionIndex >= 0)
                this.selectSubscription(this.currentSubscriptionIndex, container);
            return;
        }

        this.isSearchMode = true;
        const all: Article[] = [];
        const cached: CachedArticles = await this.loadData(CACHED_ARTICLES_NAME) || {};
        Object.values(cached).forEach(articles => all.push(...articles));

        const results = all.filter(a =>
            a.title.toLowerCase().includes(this.searchQuery) ||
            (a.content || a.description).toLowerCase().includes(this.searchQuery)
        ).sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

        this.currentArticles = results.slice(0, 50);
        this.currentArticleIndex = -1;

        const countEl = container.querySelector("#articleCount") as HTMLElement;
        if (countEl) countEl.textContent = `馃攳 ${results.length}`;

        if (results.length === 0) {
            (container.querySelector("#rssArticleList") as HTMLElement).innerHTML =
                `<div style="padding:20px;text-align:center;color:var(--b3-font-color-quaternary);font-size:13px;">馃攳 ${this.i18n.noResults}</div>`;
            return;
        }

        this.renderArticleList(container, false);
    }

    private highlightSearchTerm(text: string): string {
        if (!this.searchQuery) return text;
        const regex = new RegExp(`(${this.escapeRegex(this.searchQuery)})`, 'gi');
        return text.replace(regex, '<mark style="background:var(--b3-theme-primary-light);color:var(--b3-theme-primary);padding:0 2px;border-radius:2px;">$1</mark>');
    }

    private escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    private async refreshCurrentFeed(container: HTMLElement) {
        if (this.currentSubscriptionIndex < 0) return;
        showMessage(this.i18n.refreshing, 1500);
        await this.selectSubscription(this.currentSubscriptionIndex, container);
        showMessage(this.i18n.refreshSuccess, 1500);
    }

    // ✅ 全自动保存：无需弹窗，自动保存到上次使用的笔记本
    private async saveArticleToSiYuan(article: Article) {
        try {
            // 获取笔记本列表
            const notebooks = await fetchSyncPost("/api/notebook/lsNotebooks", {});
            const allNotebooks = notebooks.data?.notebooks || [];
            const openNotebooks = allNotebooks.filter((nb: any) => !nb.closed);

            if (!openNotebooks.length) {
                showMessage("没有打开的笔记本，无法保存", 3000);
                return;
            }

            // 确定目标笔记本：优先用上次使用的，否则用第一个
            let targetNbId = this.settings.lastUsedNotebookId;
            if (!targetNbId || !openNotebooks.find((nb: any) => nb.id === targetNbId)) {
                targetNbId = openNotebooks[0].id;
            }

            let fileName = article.title
                .replace(/[/\\:*?"<>|]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 180);
            if (!fileName) fileName = `RSS_${Date.now()}`;

            // ✅ 保留图片和排版：使用 htmlToMarkdown 转换（支持 img/strong/em/links 等）
            const articleHTML = article.content || article.description || "";
            console.log("[RSS] Save article:", article.title, "contentLen:", article.content?.length, "descLen:", article.description?.length, "htmlLen:", articleHTML.length);
            console.log("[RSS] Content preview (first 500):", articleHTML.substring(0, 500));
            const articleMarkdown = this.htmlToMarkdown(articleHTML);
            console.log("[RSS] Markdown length:", articleMarkdown.length, "preview (first 500):", articleMarkdown.substring(0, 500));

            // 元信息行
            let metaLines: string[] = [];
            if (article.pubDate) {
                metaLines.push(`> 发布于 ${new Date(article.pubDate).toLocaleString("zh-CN")}`);
            }
            if (article.link) {
                metaLines.push(`> [原文链接](${article.link})`);
            }

            // 构建完整 Markdown（一次性写入，避免 insertBlock 块树问题）
            const fullMd = [
                `# ${fileName}`,
                ...metaLines,
                "",
                articleMarkdown
            ].join("\n");

            showMessage(`正在保存到「${openNotebooks.find((n: any) => n.id === targetNbId)?.name || '笔记本'}」…`, 2000);

            console.log("[RSS] Full markdown length:", fullMd.length, "preview:", fullMd.substring(0, 300));

            // Step 1: 创建文档（一次性写入全部内容）
            const res = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: targetNbId,
                path: `/${fileName}`,
                markdown: fullMd
            });
            console.log("[RSS] Create doc response:", JSON.stringify(res).substring(0, 500));

            if (res.code === 201 || res.code === 202) {
                // 文件已存在，用唯一名称重试
                const uniqueName = `${fileName}_${Date.now().toString(36)}`;
                const res2 = await fetchSyncPost("/api/filetree/createDocWithMd", {
                    notebook: targetNbId,
                    path: `/${uniqueName}`,
                    markdown: fullMd.replace(`# ${fileName}`, `# ${uniqueName}`)
                });
                if (!res2.data) {
                    showMessage(`${this.i18n.saveFailed}：文档已存在且重试失败`, 3000);
                    return;
                }
            } else if (!res.data) {
                showMessage(`${this.i18n.saveFailed}：无法创建文档`, 3000);
                return;
            }

            const docId = res.data;

            // Step 2: 刷新事务
            await fetchSyncPost("/api/sqlite/flushTransaction", {}).catch(() => {});

            // Step 3: 转换远程图片为本地资源（参考官方 siyuan-chrome）
            if (docId) {
                fetchSyncPost("/api/format/netImg2LocalAssets", {
                    id: docId,
                    url: article.link || ""
                }).catch(() => {}); // 静默失败，不影响保存
            }

            // Step 4: 记录本次使用的笔记本
            this.settings.lastUsedNotebookId = targetNbId;
            await this.saveSettings();

            console.log("[RSS] Save complete:", fileName);
            showMessage(`✅ 已保存：${fileName}`, 4000);

        } catch (error) {
            console.error("[RSS] Save error:", error);
            showMessage(`${this.i18n.saveFailed}：${error}`, 3000);
        }
    }


    // ✅Fix #1: DOM-based HTML鈫扢arkdown conversion (replaces fragile regex approach)
    // Regex-based conversion produced malformed markdown that crashed SiYuan's parser,
    // causing "Cannot read properties of null reading 'removeAttribute'" when opening docs.
    private htmlToMarkdown(html: string): string {
        if (!html) return "";

        // Sanitize first to remove dangerous elements
        const sanitized = this.sanitizeHTML(html);
        console.log("[RSS] htmlToMarkdown: input len=", html.length, "sanitized len=", sanitized.length);
        console.log("[RSS] htmlToMarkdown: sanitized preview=", sanitized.substring(0, 300));

        const temp = document.createElement("div");
        temp.innerHTML = sanitized;
        console.log("[RSS] htmlToMarkdown: DOM childNodes=", temp.childNodes.length, "innerHTML len=", temp.innerHTML.length);

        // Debug: log each child node
        Array.from(temp.childNodes).forEach((child, i) => {
            console.log(`[RSS] Child ${i}: nodeType=${child.nodeType} nodeName=${child.nodeName}`,
                child.nodeType === 1 ? `tag=${(child as Element).tagName} childCount=${child.childNodes.length}` : `text="${(child.textContent || "").substring(0, 50)}"`);
        });

        const md = this._nodeToMarkdown(temp);
        console.log("[RSS] htmlToMarkdown: raw md len=", md.length, "preview=", md.substring(0, 300));

        // Fallback: if DOM-based conversion returned empty but we had content,
        // use a simple regex-based approach
        if (!md.trim() && sanitized.trim()) {
            console.log("[RSS] htmlToMarkdown: DOM conversion returned empty, falling back to regex");
            return this.simpleHtmlToMarkdown(sanitized);
        }

        // Clean up whitespace
        return md.replace(/\n{3,}/g, "\n\n").trim();
    }

    private _nodeToMarkdown(node: Node, depth: number = 0): string {
        // Guard against circular DOM references (max depth 50)
        if (depth > 50) {
            console.log("[RSS] _nodeToMarkdown: MAX DEPTH reached");
            return "";
        }

        if (node.nodeType === Node.TEXT_NODE) {
            return (node.textContent || "").replace(/&nbsp;/g, " ");
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            if (depth === 0) console.log("[RSS] _nodeToMarkdown: non-element at depth 0, type=", node.nodeType);
            return "";
        }

        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        // Debug: log tag at depth 0-1 only to avoid spam
        if (depth <= 1) console.log(`[RSS] _nodeToMarkdown: depth=${depth} tag=${tag} children=${el.childNodes.length}`);

        switch (tag) {
            case "br":
                return "\n";
            case "p":
            case "div": {
                const inner = this._nodeToMarkdown(el, depth + 1);
                return inner ? (inner + "\n\n") : "";
            }
            case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
                // ✅ Fix: 使用正确的 markdown 标题格式 # 前置
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
                return `\`\`\`\n${escaped}\n\`\`\`\n\n`;
            }
            case "table": {
                // Skip table structure 鈥?extract plain text to avoid malformed table markdown
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

    private showHelpDialog() {
        const dialog = new Dialog({
            title: `📖 ${this.i18n.helpTitle}`,
            content: `<div class="b3-dialog__content" style="padding:16px;font-size:13px;">
                <div style="display:grid;grid-template-columns:60px 1fr;gap:10px;">
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">J/K</kbd></div><div>${this.i18n.helpPrevNext}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">O</kbd></div><div>${this.i18n.helpOpenOriginal}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">S</kbd></div><div>${this.i18n.helpSaveToSiYuan}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">R</kbd></div><div>${this.i18n.helpRefreshFeed}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">A</kbd></div><div>${this.i18n.helpMarkAllRead}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">/</kbd></div><div>${this.i18n.helpFocusSearch}</div>
                    <div><kbd style="background:var(--b3-theme-surface-lighter);padding:3px 8px;border-radius:3px;font-size:12px;">Esc</kbd></div><div>${this.i18n.helpExitSearch}</div>
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
            title: `鈿欙笍 ${this.i18n.settings}`,
            content: `<div class="b3-dialog__content settings-panel" style="padding:16px;font-size:13px;">
                <div class="b3-label">
                    <label>${this.i18n.articlesPerPage}</label>
                    <select class="b3-select fn__block" id="articlesPerPage">
                        <option value="10" ${this.settings.articlesPerPage === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${this.settings.articlesPerPage === 20 ? 'selected' : ''}>20</option>
                        <option value="30" ${this.settings.articlesPerPage === 30 ? 'selected' : ''}>30</option>
                        <option value="50" ${this.settings.articlesPerPage === 50 ? 'selected' : ''}>50</option>
                    </select>
                </div>
                <div class="b3-label">
                    <label>${this.i18n.fontSize}</label>
                    <select class="b3-select fn__block" id="fontSize">
                        <option value="small" ${this.settings.fontSize === 'small' ? 'selected' : ''}>${this.i18n.small}</option>
                        <option value="medium" ${this.settings.fontSize === 'medium' ? 'selected' : ''}>${this.i18n.medium}</option>
                        <option value="large" ${this.settings.fontSize === 'large' ? 'selected' : ''}>${this.i18n.large}</option>
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
                <button class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
                <div class="fn__space"></div>
                <button class="b3-button b3-button--text" id="saveSettings">${this.i18n.save}</button>
            </div>`,
            width: "400px",
        });
        // ✅Fix z-index to be above sticky header
        requestAnimationFrame(() => { if (dialog.element) dialog.element.style.zIndex = "9999"; });

        (dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement).onclick = () => dialog.destroy();

        dialog.element.querySelector("#saveSettings")?.addEventListener("click", async () => {
            this.settings.articlesPerPage = parseInt((dialog.element.querySelector("#articlesPerPage") as HTMLSelectElement).value);
            this.settings.fontSize = (dialog.element.querySelector("#fontSize") as HTMLSelectElement).value as 'small' | 'medium' | 'large';
            this.settings.autoMarkRead = (dialog.element.querySelector("#autoMarkRead") as HTMLInputElement).checked;
            this.settings.autoRefreshInterval = parseInt((dialog.element.querySelector("#autoRefreshInterval") as HTMLSelectElement).value);

            await this.saveData(SETTINGS_NAME, this.settings);
            this.setupAutoRefresh(container);
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
        // Block elements → newlines
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
        // ✅ Fix: 不再给 img 添加内联 style（会导致思源 AST 解析崩溃）
        c = c.replace(/<img(?![^>]*loading=)/gi, '<img loading="lazy" ');
        return c;
    }

    private formatDate(dateStr: string): string {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const diff = Date.now() - date.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return '刚刚';
        if (mins < 60) return `${mins}分钟前`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}小时前`;
        const days = Math.floor(hours / 24);
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        return date.toLocaleDateString('zh-CN');
    }
}
