const DEFAULT_I18N = {
    justNow: 'just now',
    minutesAgo: 'm ago',
    hoursAgo: 'h ago',
    yesterday: 'yesterday',
    daysAgo: 'd ago',
};

export function formatDate(dateStr: string | null | undefined, i18n?: {
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    yesterday: string;
    daysAgo: string;
}): string {
    if (dateStr == null) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    if (diff < 0) {
        const lang = (window as any).siyuan?.config?.lang || 'en';
        return date.toLocaleDateString(lang.replace('_', '-'));
    }
    const tr = i18n || DEFAULT_I18N;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return tr.justNow;
    if (mins < 60) return `${mins}${tr.minutesAgo}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}${tr.hoursAgo}`;
    const days = Math.floor(hours / 24);
    if (days === 1) return tr.yesterday;
    if (days < 7) return `${days}${tr.daysAgo}`;
    const lang = (window as any).siyuan?.config?.lang || 'en';
    const locale = lang.replace('_', '-');
    return date.toLocaleDateString(locale);
}

export function formatUnreadCount(count: number): string {
    const clamped = Math.max(0, count);
    return clamped > 99 ? '99+' : String(clamped);
}

export function generateArticleId(link: string, title?: string, pubDate?: string): string {
    const input = link || `${title || ''}|${pubDate || ''}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash = hash & hash;
    }
    return `article_${Math.abs(hash).toString(36)}`;
}
