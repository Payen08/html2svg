import { captureFigmaLayoutBaseline, applyFigmaLayoutSafety, validateFigmaLayout, type FigmaLayoutReport } from './figmaLayoutSafetyService';
import { prepareFigmaFormControls } from './figmaFormService';
import { preserveSvgImageLayers } from './figmaSvgImageService';
import { preserveFigmaLayout } from './figmaPreserveLayoutService';
import { applyFigmaGridLayout } from './figmaGridService';
import { prepareFigmaTables, applyFigmaTableLayout } from './figmaTableService';
import { applyFigmaAutoLayout, compactFigmaRoot } from './figmaAutoLayoutService';
import { applyFigmaAlignment } from './figmaAlignmentService';
import { expandSvgUses } from './svgUseService';
import type { FigmaCopySource } from '../types';
import { createExportAssetLoader, resolveExportAssetUrl } from './exportAssetService';
import { FIGMA_TEXT_FONT, applyFigmaTextFont, normalizePingFangNames, pingFangWeight } from './figmaTextFontService';
import type { ConvertResult } from '@figit/dom-to-figma';

const fontFiles = new Map<number, Promise<ArrayBuffer>>();
function loadPingFangFile(weight: number): Promise<ArrayBuffer> {
    const resolvedWeight = pingFangWeight(weight);
    let bytes = fontFiles.get(resolvedWeight);
    if (!bytes) {
        bytes = fetch(`${import.meta.env.BASE_URL}api/figma-font?weight=${resolvedWeight}`).then(async response => {
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || '无法读取本机 PingFang SC 字体。');
            }
            return response.arrayBuffer();
        });
        fontFiles.set(resolvedWeight, bytes);
        bytes.catch(() => fontFiles.delete(resolvedWeight));
    }
    return bytes;
}

export type FigmaLayoutMode = 'preserve' | 'auto';
const prepared = new WeakMap<FigmaCopySource, Map<string, Promise<string>>>();
const layoutReports = new WeakMap<FigmaCopySource, Map<string, FigmaLayoutReport>>();
export type FigmaConversionResult = ConvertResult & {layoutReport?:FigmaLayoutReport};

/** Preserve the rich HTML envelope: plain SVG/JSON cannot carry auto-layout. */
export function writeRichClipboard(html: string): void {
    const previousFocus = document.activeElement as HTMLElement | null;
    const selection = window.getSelection();
    const ranges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const textarea = document.createElement('textarea');
    textarea.value = 'Figma design';
    textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
    const onCopy = (event: ClipboardEvent) => {
        if (!event.clipboardData) return;
        event.clipboardData.setData('text/html', html);
        event.clipboardData.setData('text/plain', 'Figma design');
        event.preventDefault();
    };
    document.body.appendChild(textarea);
    document.addEventListener('copy', onCopy);
    try {
        textarea.select();
        if (!document.execCommand('copy')) {
            throw new Error('Figma 内容已准备好，请再次点击“复制 Figma”完成复制。');
        }
    } finally {
        document.removeEventListener('copy', onCopy);
        textarea.remove();
        previousFocus?.focus({ preventScroll: true });
        if (selection) {
            selection.removeAllRanges();
            ranges.forEach(range => selection.addRange(range));
        }
    }
}

export async function convertPageToFigma(source: FigmaCopySource, name = 'Captured page', layout: FigmaLayoutMode = 'auto', onProgress?: (message: string) => void): Promise<FigmaConversionResult> {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.style.cssText = `position:fixed;left:0;top:0;width:${source.width}px;height:${source.height}px;opacity:0;pointer-events:none;border:0;z-index:-9999`;
    const doc = new DOMParser().parseFromString(source.html, 'text/html');
    doc.querySelectorAll('script, noscript, base').forEach(node => node.remove());
    doc.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attr => { if (/^on/i.test(attr.name)) node.removeAttribute(attr.name); });
    });
    const base = doc.createElement('base');
    base.href = new URL(source.baseUrl || '/', window.location.href).href;
    doc.head.prepend(base);

    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('准备 Figma 页面超时，请重试。')), 15000);
            iframe.onload = () => { if (iframe.contentDocument?.URL !== 'about:srcdoc') return; clearTimeout(timer); resolve(); };
            iframe.onerror = () => { clearTimeout(timer); reject(new Error('无法读取页面布局。')); };
            iframe.srcdoc = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
            document.body.appendChild(iframe);
        });
        const liveDoc = iframe.contentDocument;
        if (!liveDoc?.body) throw new Error('无法读取页面布局。');
        onProgress?.("处理文字…");
        applyFigmaTextFont(liveDoc);
        // The converter renders form placeholders; filled fields must use their
        // current visible value rather than losing text or showing the old hint.
        liveDoc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(field => {
            if (field.tagName === 'INPUT' && ['checkbox', 'radio', 'submit', 'button', 'file', 'hidden', 'image', 'range', 'color'].includes((field as HTMLInputElement).type)) return;
            const text = field.tagName === 'INPUT' && (field as HTMLInputElement).type === 'password'
                ? '•'.repeat(field.value.length) : field.value;
            if (text) field.setAttribute('placeholder', text);
        });
        prepareFigmaFormControls(liveDoc);
        await liveDoc.fonts.ready;

        // IMG SVGs become real vectors, while keeping their CSS layout dimensions.
        onProgress?.("处理图片…");
        const assets = createExportAssetLoader(source.baseUrl);
        await Promise.all(Array.from(liveDoc.images).map(async image => {
            const originalSrc = image.currentSrc || image.src;
            const src = resolveExportAssetUrl(originalSrc, source.baseUrl);
            if (src !== originalSrc) { image.removeAttribute('srcset'); image.src = src; }
            if (!/\.svg(?:[?#]|$)|^data:image\/svg\+xml/i.test(src)) return;
            const asset = await assets(src);
            if (asset.kind !== 'svg') return;
            const parsed = new DOMParser().parseFromString(asset.source, 'image/svg+xml');
            if (parsed.querySelector('parsererror')) throw new Error(`无法解析页面中的 SVG 图标: ${src}`);
            const svg = liveDoc.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
            svg.querySelectorAll('script, foreignObject').forEach(node => node.remove());
            const style = iframe.contentWindow!.getComputedStyle(image);
            ['width', 'height', 'display', 'position', 'top', 'left', 'right', 'bottom', 'margin', 'flex-grow', 'flex-shrink', 'align-self', 'color', 'opacity', 'transform'].forEach(property => {
                svg.style.setProperty(property, style.getPropertyValue(property));
            });
            image.replaceWith(svg);
        }));

        await expandSvgUses(liveDoc);
        await preserveSvgImageLayers(liveDoc);
        const tablePlans = layout === 'auto' ? prepareFigmaTables(liveDoc) : [];

        onProgress?.("生成 Figma 图层…");
        const { createFigmaConverter, createFontsourceLoader } = await import('@figit/dom-to-figma');
        const iconFontLoader = createFontsourceLoader();
        const fontErrors: string[] = [];
        const result = await createFigmaConverter({
            layout: layout === 'auto' ? 'auto' : 'absolute', trace: true,
            fontLoader: async request => {
                if (request.family !== FIGMA_TEXT_FONT) return iconFontLoader(request);
                try {
                    return {
                        bytes: await loadPingFangFile(request.weight),
                        resolvedWeight: pingFangWeight(request.weight), resolvedItalic: false,
                    };
                } catch (error) {
                    fontErrors.push(error instanceof Error ? error.message : '无法读取苹方字体。');
                    throw error;
                }
            },
        }).convert({
            element: liveDoc.body, width: source.width, height: source.height, name,
        });
        if (fontErrors.length) throw new Error(fontErrors[0]);
        if (liveDoc.body.innerText.trim() && !result.document.nodeChanges.some(node => node.type === 'TEXT')) {
            throw new Error('页面文字未转换成功，请检查 PingFang SC 字体后重试。');
        }
        // A failed font/image conversion must not report an empty design as success.
        if (result.document.nodeChanges.length <= 3) throw new Error('没有生成可复制的 Figma 图层，请重新捕获页面。');
        let layoutReport: FigmaLayoutReport | undefined;
        if (layout === 'auto') {
            const baseline = captureFigmaLayoutBaseline(result);
            applyFigmaAutoLayout(liveDoc.body, result);
            applyFigmaAlignment(liveDoc.body, result);
            applyFigmaGridLayout(liveDoc.body, result);
            applyFigmaTableLayout(liveDoc.body, result, tablePlans);
            layoutReport = applyFigmaLayoutSafety(liveDoc.body, result, baseline);
            compactFigmaRoot(result, name);
        } else {
            // Keep the viewport shell: removing it can lose the portrait size,
            // clipping boundary and the positions of fixed overlays.
            preserveFigmaLayout(liveDoc.body, result, source.width, source.height);
        }
        validateFigmaLayout(result);
        normalizePingFangNames(result.document.nodeChanges);
        return Object.assign(result, {layoutReport});
    } finally {
        iframe.remove();
    }
}

export async function prepareFigmaClipboard(source: FigmaCopySource, name = 'Captured page', layout: FigmaLayoutMode = 'auto', onProgress?: (message: string) => void): Promise<string> {
    const result = await convertPageToFigma(source, name, layout, onProgress);
    if (result.layoutReport) {
        const reports = layoutReports.get(source) || new Map();
        reports.set(JSON.stringify([layout, name || 'Captured page']), result.layoutReport);
        layoutReports.set(source, reports);
    }
    const { encodeFigmaData, composeClipboardHtml } = await import('@figit/fig-kiwi');
    return composeClipboardHtml(encodeFigmaData(result.document).base64);
}

export async function copyFigmaToClipboard(source: FigmaCopySource, name?: string, layout: FigmaLayoutMode = 'auto', onProgress?: (message: string) => void): Promise<FigmaLayoutReport | undefined> {
    let variants = prepared.get(source);
    if (!variants) {
        variants = new Map();
        prepared.set(source, variants);
    }
    const cacheKey = JSON.stringify([layout, name || 'Captured page']);
    let html = variants.get(cacheKey);
    if (!html) {
        onProgress?.("准备页面…");
        html = prepareFigmaClipboard(source, name, layout, onProgress);
        variants.set(cacheKey, html);
        html.catch(() => variants!.delete(cacheKey));
    }
    if (window.html2svgDesktop) {
        const value = await html;
        onProgress?.("写入剪贴板…");
        await window.html2svgDesktop.copyFigma(value);
        return layoutReports.get(source)?.get(cacheKey);
    }
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
            // Write immediately, keeping user activation while conversion runs.
            await navigator.clipboard.write([new ClipboardItem({
                'text/html': html.then(value => new Blob([value], { type: 'text/html' })),
                'text/plain': new Blob(['Figma design'], { type: 'text/plain' }),
            })]);
            return layoutReports.get(source)?.get(cacheKey);
        } catch {
            // Local HTTP and clipboard permission restrictions use a copy event.
        }
    }
    writeRichClipboard(await html);
    return layoutReports.get(source)?.get(cacheKey);
}
