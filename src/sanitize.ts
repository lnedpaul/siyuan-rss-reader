export function sanitizeHTML(html: string): string {
    if (!html) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="sano-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('sano-root');
    if (!root) return '';

    const allowedTags = new Set([
        'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
        'table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'hr',
        'strong', 'em', 'b', 'i', 'span', 'figure', 'figcaption'
    ]);

    const allowedAttrs = new Set([
        // NOTE: `id` is intentionally NOT allowed: RSS content could inject
        // duplicate ids that collide with SiYuan page elements (CSS/DOM hijack).
        'href', 'src', 'alt', 'title', 'class', 'target', 'rel',
        'width', 'height', 'loading'
    ]);

    function sanitizeNode(node: Node): Node {
        if (node.nodeType === Node.TEXT_NODE) {
            return document.createTextNode(node.textContent || '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return document.createTextNode('');
        }

        const el = node as Element;
        const tag = el.tagName.toLowerCase();

        if (tag === 'img') {
            const cls = el.getAttribute('class') || '';
            const width = el.getAttribute('width') || '';
            const height = el.getAttribute('height') || '';
            const alt = el.getAttribute('alt') || '';
            if (
                /emoji|emojione|twemoji|apple-emoji/i.test(cls) ||
                (width && parseInt(width, 10) <= 32) ||
                (height && parseInt(height, 10) <= 32)
            ) {
                return document.createTextNode(alt);
            }
        }

        if (!allowedTags.has(tag)) {
            return document.createTextNode(el.textContent || '');
        }

        const newEl = document.createElement(tag);

        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) continue;
            if (!allowedAttrs.has(name)) continue;
            let value = attr.value;
            if (name === 'href' || name === 'src') {
                value = sanitizeUrl(value);
                if (value === '#') continue;
            }
            newEl.setAttribute(name, value);
        }

        if (tag === 'img' && !newEl.hasAttribute('loading')) {
            newEl.setAttribute('loading', 'lazy');
        }

        for (const child of Array.from(el.childNodes)) {
            newEl.appendChild(sanitizeNode(child));
        }

        return newEl;
    }

    return (sanitizeNode(root) as Element).innerHTML;
}

export function sanitizeHTMLForDisplay(html: string): string {
    const sanitized = sanitizeHTML(html);
    return sanitized.replace(
        /<img(?![^>]*style=)/gi,
        '<img style="max-width:100%;height:auto;border-radius:4px;margin:8px 0;" '
    );
}

export function escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function isValidUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

export function sanitizeUrl(url: string): string {
    if (!url) return '#';
    const lower = url.toLowerCase().trim();
    if (/^(javascript|data|vbscript|file):/.test(lower)) {
        return '#';
    }
    return url;
}

export function htmlToMarkdown(html: string): string {
    if (!html) return '';

    const sanitized = sanitizeHTML(html);
    const temp = document.createElement('div');
    temp.innerHTML = sanitized;

    const md = nodeToMarkdown(temp);
    return md.replace(/\n{3,}/g, '\n\n').trim();
}

function childrenToMarkdown(node: Node, depth: number): string {
    let result = '';
    Array.from(node.childNodes).forEach((child) => {
        result += nodeToMarkdown(child, depth + 1);
    });
    return result;
}

function nodeToMarkdown(node: Node, depth: number = 0): string {
    if (depth > 50) return '';

    if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '').replace(/&nbsp;/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
    }

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
        case 'br':
            return '\n';
        case 'p':
        case 'div': {
            const result = childrenToMarkdown(node, depth);
            return result ? (result + '\n\n') : '';
        }
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
            const level = parseInt(tag[1]);
            const prefix = '#'.repeat(level);
            const result = childrenToMarkdown(node, depth);
            return result ? (`${prefix} ${result.trim()}\n\n`) : '';
        }
        case 'strong':
        case 'b': {
            const result = childrenToMarkdown(node, depth);
            return result ? (`**${result}**`) : '';
        }
        case 'em':
        case 'i': {
            const result = childrenToMarkdown(node, depth);
            return result ? (`*${result}*`) : '';
        }
        case 'u': {
            const result = childrenToMarkdown(node, depth);
            return result ? (`<u>${result}</u>`) : '';
        }
        case 's':
        case 'del': {
            const result = childrenToMarkdown(node, depth);
            return result ? (`~~${result}~~`) : '';
        }
        case 'a': {
            const href = el.getAttribute('href') || '';
            const result = childrenToMarkdown(node, depth);
            return href ? (`[${result}](${href})`) : result;
        }
        case 'img': {
            const src = el.getAttribute('src') || '';
            const alt = el.getAttribute('alt') || '';
            const cls = el.getAttribute('class') || '';
            const width = el.getAttribute('width') || '';
            const height = el.getAttribute('height') || '';
            if (
                /emoji|emojione|twemoji|apple-emoji/i.test(cls) ||
                (width && parseInt(width, 10) <= 32) ||
                (height && parseInt(height, 10) <= 32)
            ) {
                return alt || '';
            }
            return src ? (`![${alt}](${src})\n`) : '';
        }
        case 'ul': {
            let result = '\n';
            Array.from(el.children).forEach((child) => {
                if (child.tagName.toLowerCase() === 'li') {
                    const inner = nodeToMarkdown(child, depth + 1).trim();
                    result += `- ${inner}\n`;
                }
            });
            return result + '\n';
        }
        case 'ol': {
            let result = '\n';
            let count = 1;
            Array.from(el.children).forEach((child) => {
                if (child.tagName.toLowerCase() === 'li') {
                    const inner = nodeToMarkdown(child, depth + 1).trim();
                    result += `${count}. ${inner}\n`;
                    count++;
                }
            });
            return result + '\n';
        }
        case 'blockquote': {
            const result = childrenToMarkdown(node, depth);
            const lines = result.trim().split('\n').filter((l: string) => l.trim());
            if (lines.length === 0) return '';
            return lines.map((l: string) => `> ${l}`).join('\n') + '\n\n';
        }
        case 'code': {
            if (el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
                return el.textContent || '';
            }
            const result = childrenToMarkdown(node, depth);
            return result ? (`\`${result}\``) : '';
        }
        case 'pre': {
            const codeEl = el.querySelector('code');
            const text = codeEl ? (codeEl.textContent || '') : (el.textContent || '');
            if (!text.trim()) return '';
            const escaped = text.replace(/```/g, '\\`\\`\\`');
            return '```\n' + escaped + '\n```\n\n';
        }
        case 'table': {
            const rows: string[] = [];
            el.querySelectorAll('tr').forEach((tr) => {
                const cells: string[] = [];
                tr.querySelectorAll('td, th').forEach((td) => {
                    cells.push(nodeToMarkdown(td, depth + 1).trim().replace(/\|/g, ' / '));
                });
                if (cells.length > 0) rows.push(cells.join(' | '));
            });
            if (rows.length === 0) return '';
            const colCount = (rows[0]?.match(/\|/g) || []).length + 1;
            const sep = Array(colCount).fill('---').join(' | ');
            const headerRow = rows[0];
            const dataRows = rows.slice(1);
            if (dataRows.length === 0) return '\n' + headerRow + '\n' + sep + '\n\n';
            return '\n' + headerRow + '\n' + sep + '\n' + dataRows.join('\n') + '\n\n';
        }
        case 'hr':
            return '\n---\n\n';
        case 'script':
        case 'style':
        case 'iframe':
        case 'svg':
            return '';
        default: {
            let result = '';
            Array.from(node.childNodes).forEach((child) => {
                result += nodeToMarkdown(child, depth + 1);
            });
            return result;
        }
    }
}
