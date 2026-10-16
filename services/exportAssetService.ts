export type ExportAsset = { kind: 'svg'; source: string } | { kind: 'image'; source: string };

/** Resolve escaped root assets using this capture's proxy, never another tab. */
export function resolveExportAssetUrl(url: string, baseUrl?: string): string {
    if (!baseUrl || /^(data:|blob:|#)/i.test(url)) return url;
    try {
        const base = new URL(baseUrl);
        const match = base.pathname.match(/^\/(?:proxy-url\/[^/]+|proxy\/\d+)(?=\/|$)/);
        if (!match) return url;
        const resolved = new URL(url, base);
        const prefix = match[0];
        const targetOrigin = prefix.startsWith('/proxy-url/')
            ? new URL(decodeURIComponent(prefix.slice('/proxy-url/'.length))).origin
            : `http://127.0.0.1:${prefix.slice('/proxy/'.length)}`;
        if (resolved.origin !== base.origin && resolved.origin !== targetOrigin) return url;
        if (resolved.origin === base.origin && /^\/(?:proxy|proxy-url|__html2svg_internal__)(?:\/|$)/.test(resolved.pathname)) return resolved.href;
        return base.origin + prefix + resolved.pathname + resolved.search + resolved.hash;
    } catch { return url; }
}

/** Each export owns its cache, so repeated icons share a fetch without stale assets. */
export function createExportAssetLoader(baseUrl?: string) {
    const cache = new Map<string, Promise<ExportAsset>>();
    return (url: string): Promise<ExportAsset> => {
        url = resolveExportAssetUrl(url, baseUrl);
        const cached = cache.get(url);
        if (cached) return cached;
        const request = (async (): Promise<ExportAsset> => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`图片资源加载失败 (${response.status}): ${url}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
            const isSvg = type === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(url) || /^data:image\/svg\+xml/i.test(url);
            if (isSvg) {
                const source = new TextDecoder().decode(bytes);
                if (!/<svg\b/i.test(source)) throw new Error(`SVG 图标内容无效: ${url}`);
                return { kind: 'svg', source };
            }
            if (!type.startsWith('image/')) throw new Error(`图片资源类型无效: ${url}`);
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            }
            return { kind: 'image', source: `data:${type};base64,${btoa(binary)}` };
        })();
        cache.set(url, request);
        return request;
    };
}
