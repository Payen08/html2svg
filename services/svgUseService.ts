import { createExportAssetLoader } from './exportAssetService';

/** Exporters cannot resolve sprite references; materialize their vector geometry. */
export async function expandSvgUses(doc: Document): Promise<void> {
    const assets = createExportAssetLoader(doc.baseURI);
    const sprites = new Map<string, Promise<Document>>();
    for (let depth = 0; depth < 8; depth++) {
        const uses = Array.from(doc.querySelectorAll('svg use'));
        if (!uses.length) return;
        await Promise.all(uses.map(async use => {
            const href = use.getAttribute('href') || use.getAttribute('xlink:href');
            if (!href) { use.remove(); return; }
            const url = new URL(href, doc.baseURI);
            const id = decodeURIComponent(url.hash.slice(1));
            url.hash = '';
            let sprite = doc;
            if (!href.startsWith('#')) {
                let pending = sprites.get(url.href);
                if (!pending) {
                    pending = assets(url.href).then(asset => {
                        if (asset.kind !== 'svg') throw new Error('图标引用不是 SVG 文件。');
                        return new DOMParser().parseFromString(asset.source, 'image/svg+xml');
                    });
                    sprites.set(url.href, pending);
                }
                sprite = await pending;
            }
            const target = sprite.getElementById(id);
            if (!target) throw new Error(`找不到 SVG 图标: ${href}`);
            const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
            for (const attr of Array.from(use.attributes)) {
                if (!['href', 'xlink:href', 'x', 'y', 'width', 'height'].includes(attr.name)) group.setAttribute(attr.name, attr.value);
            }
            const x = use.getAttribute('x') || '0';
            const y = use.getAttribute('y') || '0';
            group.setAttribute('transform', `${group.getAttribute('transform') || ''} translate(${x} ${y})`.trim());
            if (target.tagName.toLowerCase() === 'symbol') {
                const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
                for (const attr of Array.from(target.attributes)) {
                    if (attr.name !== 'id') svg.setAttribute(attr.name, attr.value);
                }
                svg.setAttribute('width', use.getAttribute('width') || '100%');
                svg.setAttribute('height', use.getAttribute('height') || '100%');
                // Symbol classes/styles often specify a CSS icon size. The use viewport owns sizing.
                svg.style.width = svg.getAttribute('width')!;
                svg.style.height = svg.getAttribute('height')!;
                Array.from(target.childNodes).forEach(child => svg.appendChild(doc.importNode(child, true)));
                group.appendChild(svg);
            } else {
                const clone = doc.importNode(target, true) as Element;
                clone.removeAttribute('id');
                group.appendChild(clone);
            }
            group.querySelectorAll('script, foreignObject').forEach(node => node.remove());
            // Nested references are relative to their own sprite file.
            group.querySelectorAll('use').forEach(nested => {
                const value = nested.getAttribute('href') || nested.getAttribute('xlink:href');
                if (value && sprite !== doc) nested.setAttribute('href', new URL(value, url.href).href);
            });
            use.replaceWith(group);
        }));
    }
    if (doc.querySelector('svg use')) throw new Error('SVG 图标包含循环引用。');
}
