export type ExportAsset = { kind: 'svg'; source: string } | { kind: 'image'; source: string };

/** Each export owns its cache, so repeated icons share a fetch without stale assets. */
export function createExportAssetLoader() {
    const cache = new Map<string, Promise<ExportAsset>>();
    return (url: string): Promise<ExportAsset> => {
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
