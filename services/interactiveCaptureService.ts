/**
 * Interactive Capture Service
 * 
 * Creates a visible, interactive iframe that loads a page and allows
 * the user to interact with it (click buttons, open modals, navigate).
 * Provides a capture() method that extracts the current DOM and converts
 * it to SVG using the proven convertHtmlToSvgLocal pipeline.
 */

import { convertHtmlToSvgLocal } from './localService';
import { convertUrlToSvgWithForeignObject } from './urlScreenshotService';

export interface InteractiveCaptureResult {
    svg: string;
    url: string;
}

export interface InteractiveCaptureHandle {
    iframe: HTMLIFrameElement;
    capture: () => Promise<InteractiveCaptureResult>;
    getCurrentUrl: () => string;
    destroy: () => void;
}

function freezeCapturedHtml(html: string, proxyPrefix?: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Rewrite absolute paths to go through proxy (e.g. /@vite/client → /proxy/51078/@vite/client)
    // This prevents CORS errors when the captured HTML is rendered in a new srcdoc iframe
    if (proxyPrefix) {
        doc.querySelectorAll('[src], [href]').forEach((el) => {
            const src = el.getAttribute('src');
            const href = el.getAttribute('href');
            if (src && src.startsWith('/') && !src.startsWith('//')) {
                el.setAttribute('src', proxyPrefix.replace(/\/$/, '') + src);
            }
            if (href && href.startsWith('/') && !href.startsWith('//') && !href.startsWith(proxyPrefix)) {
                el.setAttribute('href', proxyPrefix.replace(/\/$/, '') + href);
            }
        });
    }

    doc.querySelectorAll('script, noscript, base').forEach((node) => node.remove());
    doc.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes).forEach((attr) => {
            if (/^on/i.test(attr.name)) {
                node.removeAttribute(attr.name);
            }
        });
    });

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function getDocumentBaseUrl(currentUrl: string, fallbackBaseUrl: string): string | undefined {
    if (!currentUrl) return fallbackBaseUrl || undefined;

    try {
        const parsed = new URL(currentUrl, window.location.origin);
        parsed.hash = '';
        parsed.search = '';

        if (!parsed.pathname.endsWith('/')) {
            const lastSlash = parsed.pathname.lastIndexOf('/');
            parsed.pathname = lastSlash >= 0 ? parsed.pathname.slice(0, lastSlash + 1) : '/';
        }

        return parsed.href;
    } catch {
        return fallbackBaseUrl || undefined;
    }
}

function capturedHtmlHasVisibleContent(html: string): boolean {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());

    const bodyText = (doc.body?.textContent || '').replace(/\s+/g, '');
    if (bodyText.length > 0) return true;

    return Boolean(doc.body?.querySelector('img, svg, canvas, video, picture'));
}

function isSvgLikelyBlank(svg: string): boolean {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const textCount = Array.from(doc.querySelectorAll('text')).filter((node) => node.textContent?.trim()).length;
    const imageCount = doc.querySelectorAll('image').length;
    const shapeCount = doc.querySelectorAll('path, circle, ellipse, line, polyline, polygon').length;
    const rectCount = doc.querySelectorAll('rect').length;

    return textCount === 0 && imageCount === 0 && shapeCount === 0 && rectCount <= 1;
}

function isLikelyProxyUrl(currentUrl: string): boolean {
    try {
        const pathname = new URL(currentUrl, window.location.origin).pathname;
        return pathname.startsWith('/proxy/') || pathname.startsWith('/proxy-url/');
    } catch {
        return false;
    }
}

export function createInteractiveCapture(
    url: string,
    baseUrl: string = '',
    viewportW: number = 1440,
    viewportH: number = 900
): InteractiveCaptureHandle {
    const iframe = document.createElement('iframe');
    iframe.style.width = viewportW + 'px';
    iframe.style.height = viewportH + 'px';
    iframe.style.maxWidth = '100%';
    iframe.style.border = 'none';
    iframe.style.background = '#fff';
    iframe.style.flexShrink = '0';
    // No sandbox — we load from our own proxy, sandbox can block
    // same-origin DOM access after page navigations/redirects.
    iframe.setAttribute('width', String(viewportW));
    iframe.setAttribute('height', String(viewportH));

    let isLoaded = false;
    let loadError: string | null = null;
    let lastKnownUrl = url;

    const getCurrentUrl = (): string => {
        try {
            const currentUrl = iframe.contentWindow?.location.href;
            if (currentUrl) {
                lastKnownUrl = currentUrl;
                return currentUrl;
            }
        } catch {
            // Cross-origin navigations cannot be inspected directly.
        }

        return lastKnownUrl || iframe.src || url;
    };

    iframe.onload = () => {
        // Ignore about:blank load (fires before src is set or during init)
        if (iframe.src && iframe.src !== 'about:blank') {
            isLoaded = true;
            lastKnownUrl = getCurrentUrl();
        }
    };
    iframe.onerror = () => {
        loadError = 'Iframe failed to load';
    };

    // Set src after onload handler to avoid missing the event
    iframe.src = url;

    const waitForLoad = (): Promise<void> => {
        if (isLoaded) return Promise.resolve();
        if (loadError) return Promise.reject(new Error(loadError));
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = setInterval(() => {
                if (isLoaded) { clearInterval(check); resolve(); }
                else if (loadError) { clearInterval(check); reject(new Error(loadError)); }
                else if (Date.now() - start > 15000) { clearInterval(check); reject(new Error('Page load timeout')); }
            }, 200);
        });
    };

    const capture = async (): Promise<InteractiveCaptureResult> => {
        await waitForLoad();
        const targetWindow = iframe.contentWindow;

        if (!targetWindow) {
            throw new Error('Interactive iframe is not ready');
        }

        const convertCapturedHtml = async (html: string, currentUrl: string): Promise<InteractiveCaptureResult> => {
            // Rewrite absolute paths through proxy (e.g. /@vite/client → /proxy/51078/@vite/client)
            const proxyPrefix = baseUrl || '';
            const currentHtml = freezeCapturedHtml(html, proxyPrefix);
            const currentBaseUrl = getDocumentBaseUrl(currentUrl, baseUrl);
            let svg = await convertHtmlToSvgLocal(currentHtml, false, currentBaseUrl, false, undefined, false);
            if (isSvgLikelyBlank(svg) && capturedHtmlHasVisibleContent(currentHtml)) {
                svg = await convertUrlToSvgWithForeignObject(
                    currentHtml,
                    currentBaseUrl || baseUrl || window.location.origin,
                    viewportW,
                    Math.max(viewportH, 2400)
                );
            }
            return { svg, url: currentUrl };
        };

        const captureDirectlyFromIframe = async (): Promise<InteractiveCaptureResult> => {
            const doc = iframe.contentDocument || targetWindow.document;
            if (!doc?.documentElement) {
                throw new Error('无法直接读取当前 iframe DOM');
            }

            const currentUrl = getCurrentUrl();
            const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
            return convertCapturedHtml(html, currentUrl);
        };

        // Use postMessage to capture DOM — works even if the iframe navigated
        // cross-origin (our proxy injects a capture helper script into the page).
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                captureDirectlyFromIframe()
                    .then(resolve)
                    .catch((fallbackErr: any) => {
                        const currentUrl = getCurrentUrl();
                        const proxyHint = isLikelyProxyUrl(currentUrl)
                            ? '当前页在代理内，但注入脚本没有响应。'
                            : '当前页似乎已经跳出了同源代理。请重新启动交互预览。';
                        reject(new Error(`Capture timeout — page may not have loaded via proxy. ${proxyHint} 当前地址: ${currentUrl}. ${fallbackErr.message || fallbackErr}`));
                    });
            }, 15000);

            const handler = (event: MessageEvent) => {
                if (event.source !== targetWindow) return;

                if (event.data?.type === 'html2svg-capture-result') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);
                    const currentUrl = event.data.url as string || getCurrentUrl();

                    convertCapturedHtml(event.data.html as string, currentUrl)
                        .then(resolve)
                        .catch(reject);
                } else if (event.data?.type === 'html2svg-capture-error') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);
                    reject(new Error(event.data.error));
                }
            };

            window.addEventListener('message', handler);

            // Send capture request to iframe
            targetWindow.postMessage({ type: 'html2svg-capture' }, '*');
        });
    };

    const destroy = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    return { iframe, capture, getCurrentUrl, destroy };
}
