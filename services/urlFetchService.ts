/**
 * URL Fetch Service
 * Fetches HTML content from URLs:
 * - Remote URLs → via CORS proxy (allorigins.win / corsproxy.io)
 * - file:// URLs → via local Vite dev server API
 * - localhost URLs → via local Vite dev server API (avoids CORS)
 */

export interface FetchResult {
    html: string;
    url: string;
    title?: string;
}

/**
 * Check if a URL is a local file:// URL
 */
function isFileUrl(url: string): boolean {
    return url.startsWith('file://');
}

/**
 * Check if a URL points to localhost or local network.
 * Handles URLs with or without protocol prefix.
 */
function isLocalhostUrl(url: string): boolean {
    // Try as-is first
    let hostname = tryParseHostname(url);
    if (hostname) {
        return isLocalHostname(hostname);
    }
    // If that fails, try adding http:// prefix
    if (!url.includes('://')) {
        hostname = tryParseHostname('http://' + url);
        if (hostname) {
            return isLocalHostname(hostname);
        }
    }
    return false;
}

function tryParseHostname(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

function isLocalHostname(hostname: string): boolean {
    if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(hostname)) {
        return true;
    }
    if (/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(hostname)) {
        return true;
    }
    return false;
}

/**
 * Extract file path from a file:// URL
 */
function fileUrlToPath(fileUrl: string): string {
    // file:///Users/... → /Users/...
    // file:///C:/Users/... → C:/Users/... (Windows)
    let path = fileUrl.replace(/^file:\/\//, '');
    return decodeURIComponent(path);
}

/**
 * Fetch HTML from a local file via the Vite dev server API
 */
async function fetchLocalFile(filePath: string): Promise<FetchResult> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const apiUrl = `${origin}/api/read-local-file?path=${encodeURIComponent(filePath)}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `无法读取本地文件 (HTTP ${response.status})`);
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    // Build file:// URL for base resolution
    const fileUrl = `file://${filePath}`;

    // Fix relative URLs using file:// base
    const fixedHtml = fixRelativeUrls(html, fileUrl);

    return { html: fixedHtml, url: fileUrl, title };
}

/**
 * Fetch HTML from a localhost URL via the Vite dev server (no CORS issues)
 */
async function fetchLocalhostUrl(url: string): Promise<FetchResult> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const apiUrl = `${origin}/api/fetch-local-url?url=${encodeURIComponent(url)}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `无法获取本地服务内容 (HTTP ${response.status})`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error);
    }

    let html = data.html;
    const title = data.title;
    // Use the actual URL from the server response (may have resolved localhost → 127.0.0.1)
    const actualUrl = data.url || url;

    // Ensure charset meta tag
    if (!html.includes('charset')) {
        html = html.replace(/<head([^>]*)>/i, '<head$1><meta charset="UTF-8">');
    }

    // NOTE: We do NOT call fixRelativeUrls here for localhost URLs.
    // URL rewriting (absolute paths → proxy paths) is handled in App.tsx
    // where we can construct the correct proxy URL (/proxy/{port}/).

    return { html, url: actualUrl, title };
}

/**
 * Main entry: fetch HTML content from any URL
 */
export async function fetchUrlContent(url: string): Promise<FetchResult> {
    if (!url.trim()) {
        throw new Error('请输入 URL');
    }

    let trimmedUrl = url.trim();

    // --- file:// URLs: read via local Vite API ---
    if (isFileUrl(trimmedUrl)) {
        const filePath = fileUrlToPath(trimmedUrl);
        return fetchLocalFile(filePath);
    }

    // Normalize: add http:// if no protocol present
    if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmedUrl)) {
        trimmedUrl = 'http://' + trimmedUrl;
    }

    // --- localhost URLs: fetch via local Vite API (server-side, no CORS) ---
    if (isLocalhostUrl(trimmedUrl)) {
        return fetchLocalhostUrl(trimmedUrl);
    }

    // --- Remote URLs: use CORS proxy ---
    // Ensure https for remote URLs
    if (trimmedUrl.startsWith('http://')) {
        // Keep http if user explicitly used it (some sites don't have https)
        // but most remote sites should use https
    }

    // Try allorigins with JSON response (better encoding support)
    try {
        const proxyUrl = `https://api.allorigins.win/get?charset=utf-8&url=${encodeURIComponent(trimmedUrl)}`;

        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.contents) {
            throw new Error('获取的内容为空');
        }

        let html = data.contents;

        // Ensure proper charset meta tag for SVG rendering
        if (!html.includes('charset')) {
            html = html.replace(/<head([^>]*)>/i, '<head$1><meta charset="UTF-8">');
        }

        // Extract title from HTML
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : undefined;

        // Fix relative URLs in HTML to absolute URLs
        const fixedHtml = fixRelativeUrls(html, trimmedUrl);

        return {
            html: fixedHtml,
            url: trimmedUrl,
            title,
        };
    } catch (err: any) {
        console.error('AllOrigins fetch failed:', err);

        // Fallback: try corsproxy.io
        try {
            return await fetchWithCorsproxy(trimmedUrl);
        } catch (fallbackErr: any) {
            throw new Error(err.message || '无法获取网页内容，请检查 URL 是否正确');
        }
    }
}

/**
 * Fallback fetch using corsproxy.io
 */
async function fetchWithCorsproxy(url: string): Promise<FetchResult> {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

    const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml',
        },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    let html = decoder.decode(arrayBuffer);

    // If still garbled, try detecting charset from HTML
    const charsetMatch = html.match(/charset=["']?([^"'\s>]+)/i);
    if (charsetMatch && charsetMatch[1].toLowerCase() !== 'utf-8') {
        try {
            const alternateDecoder = new TextDecoder(charsetMatch[1]);
            html = alternateDecoder.decode(arrayBuffer);
        } catch (e) {
            // Keep UTF-8 decoded version
        }
    }

    // Ensure charset meta tag
    if (!html.includes('charset')) {
        html = html.replace(/<head([^>]*)>/i, '<head$1><meta charset="UTF-8">');
    }

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    const fixedHtml = fixRelativeUrls(html, url);

    return {
        html: fixedHtml,
        url,
        title,
    };
}

/**
 * Convert relative URLs to absolute URLs in HTML
 */
function fixRelativeUrls(html: string, baseUrl: string): string {
    let base: URL;
    try {
        base = new URL(baseUrl);
    } catch {
        // For file:// URLs, URL constructor may fail, skip fixing
        return html;
    }

    const baseOrigin = base.origin;
    const basePath = base.pathname.replace(/\/[^/]*$/, '/');

    let fixed = html;

    // Fix absolute paths (starting with /)
    fixed = fixed.replace(/(href|src)=["']\/(?!\/)/g, `$1="${baseOrigin}/`);

    // Fix protocol-relative URLs
    fixed = fixed.replace(/(href|src)=["']\/\//g, `$1="https://`);

    // Add base tag for remaining relative URLs
    if (!fixed.includes('<base')) {
        fixed = fixed.replace(/<head([^>]*)>/i, `<head$1><base href="${baseOrigin}${basePath}">`);
    }

    return fixed;
}

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(str: string): boolean {
    try {
        let url = str.trim();
        // Support file:// URLs
        if (url.startsWith('file://')) {
            return url.length > 7; // file:// + at least one char
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        new URL(url);
        return true;
    } catch {
        return false;
    }
}
