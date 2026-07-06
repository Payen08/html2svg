/**
 * URL Screenshot to SVG Service
 * Uses browser screenshot capabilities to capture external websites
 * and convert them to SVG using foreignObject
 */

export interface ScreenshotResult {
    svg: string;
    width: number;
    height: number;
}

/**
 * Create an SVG that embeds the HTML using foreignObject
 * This preserves the HTML structure and allows external CSS to load
 */
export async function convertUrlToSvgWithForeignObject(
    html: string,
    baseUrl: string,
    width: number = 1440,
    height: number = 2400  // Increased height to capture more content
): Promise<string> {
    // Create a complete HTML document with proper base URL
    const wrappedHtml = wrapHtmlWithBase(html, baseUrl);

    // Escape HTML for embedding in SVG - more aggressive escaping
    const escapedHtml = escapeHtmlForSvg(wrappedHtml);

    // Create SVG with foreignObject (no XML declaration for better compatibility)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" 
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" 
     height="${height}" 
     viewBox="0 0 ${width} ${height}">
  <defs>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&amp;display=swap');
    </style>
  </defs>
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;min-height:${height}px;overflow:visible;background:white;">
      ${escapedHtml}
    </div>
  </foreignObject>
</svg>`;

    return svg;
}

/**
 * Alternative: Create an SVG with the HTML rendered in an iframe and captured
 */
export async function convertUrlToSvgWithCapture(
    html: string,
    baseUrl: string,
    width: number = 1440,
    height: number = 2400
): Promise<string> {
    return new Promise((resolve, reject) => {
        // Create hidden iframe
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: ${width}px;
            height: ${height}px;
            opacity: 0;
            pointer-events: none;
            z-index: -9999;
            border: none;
        `;

        // Prepare HTML with proper base URL
        const wrappedHtml = wrapHtmlWithBase(html, baseUrl);

        document.body.appendChild(iframe);

        iframe.onload = async () => {
            try {
                // Wait for resources to load
                await new Promise(res => setTimeout(res, 3000));

                const iframeDoc = iframe.contentDocument;
                const iframeWin = iframe.contentWindow;

                if (!iframeDoc || !iframeWin) {
                    throw new Error('Cannot access iframe content');
                }

                // Get actual content dimensions
                const body = iframeDoc.body;
                const contentWidth = Math.max(body.scrollWidth, width);
                const contentHeight = Math.max(body.scrollHeight, height);

                // Create SVG with foreignObject embedding the iframe content
                const svg = createSvgFromIframe(iframeDoc, contentWidth, Math.min(contentHeight, height * 2));

                resolve(svg);
            } catch (err) {
                // Fallback to foreignObject method
                console.warn('Capture failed, using foreignObject fallback:', err);
                const fallbackSvg = await convertUrlToSvgWithForeignObject(html, baseUrl, width, height);
                resolve(fallbackSvg);
            } finally {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
            }
        };

        iframe.onerror = () => {
            reject(new Error('Failed to load content in iframe'));
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
            }
        };

        iframe.srcdoc = wrappedHtml;
    });
}

/**
 * Wrap HTML content with proper base URL and charset
 */
function wrapHtmlWithBase(html: string, baseUrl: string): string {
    // Extract origin for resources
    let origin = baseUrl;
    try {
        const url = new URL(baseUrl);
        origin = url.origin;
    } catch (e) {
        // Use baseUrl as-is
    }

    // If already has DOCTYPE, just add base tag
    if (html.toLowerCase().includes('<!doctype')) {
        // Insert base tag after <head>
        if (!html.includes('<base')) {
            html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/"><meta charset="UTF-8">`);
        }
        return html;
    }

    // Wrap in complete HTML document
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <base href="${origin}/">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif; }
        * { box-sizing: border-box; }
    </style>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * Escape HTML for embedding in SVG
 */
function escapeHtmlForSvg(html: string): string {
    // For foreignObject, we need to ensure the HTML is valid XHTML
    // Replace common HTML entities and fix self-closing tags
    let escaped = html
        // Fix ampersands that aren't part of entities
        .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;')
        // Fix self-closing tags
        .replace(/<br\s*>/gi, '<br/>')
        .replace(/<hr\s*>/gi, '<hr/>')
        .replace(/<img\s+([^>]*[^\/])\s*>/gi, '<img $1/>')
        .replace(/<input\s+([^>]*[^\/])\s*>/gi, '<input $1/>')
        .replace(/<meta\s+([^>]*[^\/])\s*>/gi, '<meta $1/>')
        .replace(/<link\s+([^>]*[^\/])\s*>/gi, '<link $1/>')
        .replace(/<source\s+([^>]*[^\/])\s*>/gi, '<source $1/>')
        .replace(/<embed\s+([^>]*[^\/])\s*>/gi, '<embed $1/>')
        .replace(/<area\s+([^>]*[^\/])\s*>/gi, '<area $1/>')
        .replace(/<col\s+([^>]*[^\/])\s*>/gi, '<col $1/>')
        .replace(/<param\s+([^>]*[^\/])\s*>/gi, '<param $1/>')
        .replace(/<track\s+([^>]*[^\/])\s*>/gi, '<track $1/>')
        .replace(/<wbr\s*>/gi, '<wbr/>')
        // Remove script tags (they won't execute anyway)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove noscript tags content
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

    return escaped;
}

/**
 * Create SVG from iframe document content
 */
function createSvgFromIframe(doc: Document, width: number, height: number): string {
    const serializer = new XMLSerializer();
    const htmlContent = serializer.serializeToString(doc);

    // Clean up the serialized HTML
    let cleanHtml = htmlContent
        .replace(/xmlns="[^"]*"/g, '')
        .replace(/xmlns:xhtml="[^"]*"/g, '');

    return `<svg xmlns="http://www.w3.org/2000/svg" 
     xmlns:xhtml="http://www.w3.org/1999/xhtml"
     width="${width}" 
     height="${height}" 
     viewBox="0 0 ${width} ${height}">
  <defs>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&amp;display=swap');
    </style>
  </defs>
  <foreignObject x="0" y="0" width="100%" height="100%">
    ${cleanHtml}
  </foreignObject>
</svg>`;
}
