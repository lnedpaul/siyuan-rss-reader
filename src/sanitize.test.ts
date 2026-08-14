import { describe, it, expect } from "vitest";
import { sanitizeHTML, sanitizeHTMLForDisplay, escapeHtml, isValidUrl, sanitizeUrl, htmlToMarkdown } from "./sanitize";

describe("sanitizeHTML", () => {
    it("removes script tags", () => {
        const result = sanitizeHTML("<script>alert(1)</script>hello");
        expect(result).not.toContain("script");
        expect(result).toContain("hello");
    });

    it("removes event handlers", () => {
        const result = sanitizeHTML('<img src=x onerror=alert(1)>');
        expect(result).not.toContain("onerror");
    });

    it("removes unquoted event handlers", () => {
        const result = sanitizeHTML('<img src=x onerror=alert(1)>');
        expect(result).not.toContain("onerror");
    });

    it("strips javascript: href", () => {
        const result = sanitizeHTML('<a href="javascript:alert(1)">link</a>');
        expect(result).not.toContain("javascript:");
    });

    it("strips javascript: in unquoted href", () => {
        const result = sanitizeHTML('<a href=javascript:alert(1)>link</a>');
        expect(result).not.toContain("javascript:");
    });

    it("allows http/https href", () => {
        const result = sanitizeHTML('<a href="https://example.com">link</a>');
        expect(result).toContain('href="https://example.com"');
    });

    it("allows safe tags", () => {
        const result = sanitizeHTML("<p><strong>bold</strong> <em>italic</em></p>");
        expect(result).toContain("<strong>");
        expect(result).toContain("<em>");
    });

    it("strips dangerous tags", () => {
        const result = sanitizeHTML('<iframe src="https://evil.com"></iframe><object data="x"></object>');
        expect(result).not.toContain("iframe");
        expect(result).not.toContain("object");
    });

    it("strips style tags", () => {
        const result = sanitizeHTML("<style>body{color:red}</style>text");
        expect(result).not.toContain("style");
        expect(result).toContain("text");
    });

    it("replaces emoji images with alt text", () => {
        const result = sanitizeHTML('<img class="emoji" src="smile.png" alt="smile">');
        expect(result).toBe("smile");
    });

    it("replaces small images (<=32px) with alt text", () => {
        const result = sanitizeHTML('<img src="icon.png" width="16" height="16" alt="icon">');
        expect(result).toBe("icon");
    });

    it("keeps large images", () => {
        const result = sanitizeHTML('<img src="photo.jpg" width="800" alt="photo">');
        expect(result).toContain("<img");
        expect(result).toContain('src="photo.jpg"');
        expect(result).toContain('loading="lazy"');
    });

    it("adds loading=lazy to img", () => {
        const result = sanitizeHTML('<img src="x.jpg" alt="x">');
        expect(result).toContain('loading="lazy"');
    });

    it("removes base and meta tags", () => {
        const result = sanitizeHTML('<base href="https://evil.com/"><meta http-equiv="refresh">text');
        expect(result).not.toContain("base");
        expect(result).not.toContain("meta");
        expect(result).toContain("text");
    });

    it("returns empty string for empty input", () => {
        expect(sanitizeHTML("")).toBe("");
    });
});

describe("sanitizeHTMLForDisplay", () => {
    it("adds responsive img styles", () => {
        const result = sanitizeHTMLForDisplay('<img src="x.jpg" alt="x">');
        expect(result).toContain("style=");
        expect(result).toContain("max-width:100%");
    });
});

describe("escapeHtml", () => {
    it("escapes & < > \" '", () => {
        expect(escapeHtml('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
    });

    it("returns empty for empty input", () => {
        expect(escapeHtml("")).toBe("");
    });

    it("passes through safe strings", () => {
        expect(escapeHtml("hello world")).toBe("hello world");
    });
});

describe("isValidUrl", () => {
    it("accepts http and https", () => {
        expect(isValidUrl("http://example.com")).toBe(true);
        expect(isValidUrl("https://example.com")).toBe(true);
    });

    it("rejects javascript:", () => {
        expect(isValidUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects data:", () => {
        expect(isValidUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    });

    it("rejects invalid strings", () => {
        expect(isValidUrl("")).toBe(false);
        expect(isValidUrl("not-a-url")).toBe(false);
    });
});

describe("sanitizeUrl", () => {
    it("returns http/https unchanged", () => {
        expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
    });

    it("allows relative paths", () => {
        expect(sanitizeUrl("/path/to/page")).toBe("/path/to/page");
        expect(sanitizeUrl("./relative.jpg")).toBe("./relative.jpg");
        expect(sanitizeUrl("../up.jpg")).toBe("../up.jpg");
    });

    it("returns # for javascript:", () => {
        expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
    });

    it("returns # for empty", () => {
        expect(sanitizeUrl("")).toBe("#");
    });
});

describe("URL attribute injection protection (href/src interpolation)", () => {
    it("escapes quotes after protocol filtering", () => {
        // Regression: selectArticle renders `<a href="${...}">` — a link with
        // embedded quotes must not break out of the attribute boundary.
        const link = 'https://example.com/" onmouseover="alert(1)';
        const href = escapeHtml(sanitizeUrl(link));
        expect(href).not.toContain('" onmouseover=');
        expect(href).toContain("&quot;");
    });

    it("kills javascript: scheme before escaping", () => {
        const href = escapeHtml(sanitizeUrl("javascript:alert(1)"));
        expect(href).toBe("#");
    });

    it("keeps https href intact after escaping", () => {
        expect(escapeHtml(sanitizeUrl("https://example.com/feed.xml"))).toBe("https://example.com/feed.xml");
    });
});

describe("htmlToMarkdown", () => {
    it("converts simple HTML to markdown", () => {
        const result = htmlToMarkdown("<p>hello</p>");
        expect(result).toContain("hello");
    });

    it("converts headings", () => {
        expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
        expect(htmlToMarkdown("<h2>Sub</h2>")).toContain("## Sub");
    });

    it("converts links", () => {
        const result = htmlToMarkdown('<a href="https://x.com">x</a>');
        expect(result).toContain("[x](https://x.com)");
    });

    it("converts images", () => {
        const result = htmlToMarkdown('<img src="pic.png" alt="pic">');
        expect(result).toContain("![pic](pic.png)");
    });

    it("converts lists", () => {
        const result = htmlToMarkdown("<ul><li>a</li><li>b</li></ul>");
        expect(result).toContain("- a");
        expect(result).toContain("- b");
    });

    it("returns empty for empty input", () => {
        expect(htmlToMarkdown("")).toBe("");
    });
});
