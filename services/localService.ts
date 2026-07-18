/**
 * Converts HTML to Figma-compatible SVG by rendering in an iframe
 * with proper script execution support.
 *
 * Key Features:
 * - Uses srcdoc with proper sandbox attributes for CDN script execution
 * - Waits for Tailwind CSS to fully process before capture
 * - Supports Linear Gradients, Box Shadows, Images
 * - Better Text Positioning (Center-based)
 * - Rasterizes Icon Fonts to <image>
 */

let uuidCounter = 0;
const getUniqueId = (prefix: string) => `${prefix}-${++uuidCounter}`;

export const convertHtmlToSvgLocal = async (
  htmlInput: string,
  optimize: boolean = false,
  baseUrl?: string,
  rasterizeText: boolean = false,
  directUrl?: string,
  executeScripts: boolean = true,
  viewportW?: number,
  viewportH?: number,
): Promise<string> => {
  if (!htmlInput.trim()) return '';

  const iframeW = viewportW || 1440;
  const iframeH = viewportH || 900;

  return new Promise((resolve, reject) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '0px';
      iframe.style.left = '0px';
      iframe.style.width = iframeW + 'px';
      iframe.style.height = iframeH + 'px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.zIndex = '-9999';
      iframe.style.border = 'none';

      // Allow scripts for normal URL/HTML conversion, but keep captured DOM
      // snapshots frozen so app boot scripts cannot rerender them back home.
      iframe.setAttribute('sandbox', executeScripts ? 'allow-scripts allow-same-origin' : 'allow-same-origin');

      document.body.appendChild(iframe);

      if (directUrl) {
        // DIRECT URL MODE: Load the page via iframe.src through our proxy.
        // This is critical for SPA apps (React/Vue/Angular) where fetch()
        // only returns an empty shell and JS must execute in a real browsing context.
        iframe.src = directUrl;
      } else {
        // SRCDOC MODE: Load raw HTML content directly
        // Prepare HTML with proper doctype if needed
        let fullHtml = htmlInput;
        if (!fullHtml.toLowerCase().includes('<!doctype')) {
          fullHtml = '<!DOCTYPE html>\n' + fullHtml;
        }

        // Inject <base> tag for relative links (CSS, Fonts, Images) logic
        if (baseUrl) {
          // Use regex to match <head> with any attributes (e.g. <head lang="en">)
          if (/<head(\s[^>]*)?>/.test(fullHtml)) {
            fullHtml = fullHtml.replace(/<head(\s[^>]*)?>/, `<head$1><base href="${baseUrl}">`);
          } else if (/<html(\s[^>]*)?>/.test(fullHtml)) {
            // If no head, try to insert after html tag
            fullHtml = fullHtml.replace(/<html(\s[^>]*)?>/, `<html$1><head><base href="${baseUrl}"></head>`);
          }
        }

        // Use srcdoc for complete HTML rendering
        iframe.srcdoc = fullHtml;
      }

      // Wait for iframe to load and scripts to execute
      iframe.onload = () => {
        // Inject styles to disable animations and force visibility of meaningful content
        try {
          const style = iframe.contentDocument?.createElement('style');
          if (style) {
            style.textContent = `
              *, *::before, *::after {
                transition: none !important;
                animation: none !important;
                transition-property: none !important;
              }
              /* Try to reveal scroll-triggered fade-ins */
              [data-anim-tween], .fade-in, .reveal, .aos-animate {
                opacity: 1 !important;
                visibility: visible !important;
              }
            `;
            iframe.contentDocument?.head.appendChild(style);
          }
        } catch (e) {
          console.warn("Failed to inject override styles", e);
        }

        // Additional wait for Tailwind to process after load
        const waitForTailwind = () => {
          return new Promise<void>((res) => {
            let attempts = 0;
            const maxAttempts = 80; // 8 seconds max

            const checkReady = () => {
              attempts++;
              try {
                const iframeDoc = iframe.contentDocument;
                const iframeWin = iframe.contentWindow;

                if (!iframeDoc || !iframeWin) {
                  if (attempts < maxAttempts) {
                    setTimeout(checkReady, 100);
                  } else {
                    res();
                  }
                  return;
                }

                // Check if Tailwind has processed by looking for generated styles
                // Tailwind CDN adds a style element
                const styleSheets = iframeDoc.styleSheets;
                let hasTailwind = false;

                for (let i = 0; i < styleSheets.length; i++) {
                  try {
                    const sheet = styleSheets[i];
                    if (sheet.cssRules && sheet.cssRules.length > 100) {
                      hasTailwind = true;
                      break;
                    }
                  } catch (e) {
                    // CORS errors for external stylesheets, which is fine
                  }
                }

                // Also check body has computed background
                const bodyStyle = iframeWin.getComputedStyle(iframeDoc.body);
                const bgColor = bodyStyle.backgroundColor;
                const hasBackground = bgColor && bgColor !== 'rgba(0, 0, 0, 0)';

                if ((hasTailwind || hasBackground) && attempts >= 10) {
                  // Wait a bit more for any final rendering
                  setTimeout(res, 300);
                  return;
                }

                if (attempts >= maxAttempts) {
                  res();
                  return;
                }

                setTimeout(checkReady, 100);
              } catch (e) {
                if (attempts < maxAttempts) {
                  setTimeout(checkReady, 100);
                } else {
                  res();
                }
              }
            };

            // Start checking after initial delay
            setTimeout(checkReady, 500);
          });
        };

        waitForTailwind().then(async () => {
          try {
            const iframeDoc = iframe.contentDocument;
            const iframeWin = iframe.contentWindow;

            if (!iframeDoc || !iframeWin) {
              reject(new Error('Cannot access iframe content'));
              return;
            }

            // --- PRE-PROCESSING: Scroll to trigger lazy loading ---
            const totalHeight = iframeDoc.body.scrollHeight;
            const viewportHeight = iframe.offsetHeight;
            for (let i = 0; i < totalHeight; i += viewportHeight) {
              iframeWin.scrollTo(0, i);
              await new Promise(r => setTimeout(r, 50));
            }
            iframeWin.scrollTo(0, 0);
            await new Promise(r => setTimeout(r, 300));

            // --- PRE-PROCESSING: Reveal Hidden Content ---
            const revealHiddenContent = (root: HTMLElement) => {
              const allElements = root.querySelectorAll('*');
              allElements.forEach((el) => {
                const style = iframeWin.getComputedStyle(el);
                if (parseFloat(style.opacity) < 0.1) {
                  // Heuristic: If it has text content or is an image, force visibility
                  if (el.textContent?.trim() || el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'SVG') {
                    (el as HTMLElement).style.opacity = '1';
                    (el as HTMLElement).style.visibility = 'visible';
                  }
                }
              });
            };
            revealHiddenContent(iframeDoc.body);
            // ---------------------------------------------

            const rootElement = iframeDoc.body;
            // Force layout recalculation
            rootElement.getBoundingClientRect();

            // Expand iframe to full content height to capture everything
            const fullHeight = Math.max(rootElement.scrollHeight, rootElement.offsetHeight, iframeDoc.documentElement.offsetHeight);
            iframe.style.height = `${fullHeight}px`;

            // Re-measure after resize
            const rootRect = rootElement.getBoundingClientRect();

            const svgWidth = Math.max(rootRect.width, iframeW);
            const svgHeight = Math.max(rootRect.height, fullHeight, 1);

            let svgElements = '';
            let defsContent = '';

            const escapeXml = (unsafe: string) => {
              return unsafe.replace(/[<>&'"]/g, c => {
                switch (c) {
                  case '<': return '&lt;';
                  case '>': return '&gt;';
                  case '&': return '&amp;';
                  case '\'': return '&apos;';
                  case '"': return '&quot;';
                  default: return c;
                }
              });
            };

            const toAbsoluteUrl = (url: string) => {
              try {
                return new URL(url, baseUrl || 'http://localhost').href;
              } catch {
                return url;
              }
            };

            const cleanText = (txt: string) => {
              // Remove Private Use Area characters often used for icons
              return txt.replace(/[\uE000-\uF8FF]/g, '');
            };

            const parseColor = (colorStr: string) => {
              if (!colorStr || colorStr === 'rgba(0, 0, 0, 0)' || colorStr === 'transparent') return null;
              return colorStr;
            };

            const processBackground = (style: CSSStyleDeclaration): string | null => {
              const bgImage = style.backgroundImage;
              const bgColor = parseColor(style.backgroundColor);

              // Handle Linear Gradients
              if (bgImage && bgImage.includes('linear-gradient')) {
                const gradId = getUniqueId('grad');

                let angle = 180;
                const angleMatch = bgImage.match(/(\d+)deg/);
                if (angleMatch) angle = parseInt(angleMatch[1]);

                const radian = (angle - 90) * (Math.PI / 180);
                const x1 = 50 + 50 * Math.cos(radian + Math.PI);
                const y1 = 50 + 50 * Math.sin(radian + Math.PI);
                const x2 = 50 + 50 * Math.cos(radian);
                const y2 = 50 + 50 * Math.sin(radian);

                const stopMatches = bgImage.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)\s*(\d+%|)/gi);

                if (stopMatches && stopMatches.length >= 2) {
                  const stops = stopMatches.map((stop, index) => {
                    const parts = stop.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)\s*(\d+%)?/i);
                    if (!parts) return '';
                    const color = parts[1];
                    const offset = parts[2] ? parts[2] : `${(index / (stopMatches.length - 1)) * 100}%`;
                    return `<stop offset="${offset}" stop-color="${color}" />`;
                  }).join('\n');

                  defsContent += `
                   <linearGradient id="${gradId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
                     ${stops}
                   </linearGradient>`;

                  return `url(#${gradId})`;
                }
              }

              // Handle radial-gradient for dot-grid background
              if (bgImage && bgImage.includes('radial-gradient')) {
                // For complex patterns, we'll just use the background color
                return bgColor;
              }

              return bgColor;
            };

            const processShadow = (style: CSSStyleDeclaration): string | null => {
              const shadow = style.boxShadow;
              if (!shadow || shadow === 'none') return null;

              const colorMatch = shadow.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
              const numsMatch = shadow.match(/(-?\d+(\.\d+)?)px/g);

              if (colorMatch && numsMatch && numsMatch.length >= 2) {
                const color = colorMatch[0];
                const dx = parseFloat(numsMatch[0]);
                const dy = parseFloat(numsMatch[1]);
                const blur = numsMatch.length > 2 ? parseFloat(numsMatch[2]) : 0;

                const filterId = getUniqueId('shadow');
                defsContent += `
                 <filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">
                   <feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur / 2}" flood-color="${color}" flood-opacity="1"/>
                 </filter>
                `;
                return `filter="url(#${filterId})"`;
              }
              return null;
            };

            // NEW: Robust Element Snapshot using foreignObject -> Canvas
            // This guarantees 100% visual fidelity including text wrapping, fonts, spacing, etc.
            const snapshotElementToImage = async (el: HTMLElement, width: number, height: number): Promise<string> => {
              try {
                const clone = el.cloneNode(true) as HTMLElement;
                // Force styles to ensure it looks right in isolation
                clone.style.margin = '0';
                clone.style.position = 'static';
                clone.style.transform = 'none';

                // We need to capture the exact computed styles if we were to be perfect, 
                // but since we are embedding the HTML, browser default rendering works best.
                // However, we need to wrap it to ensure contexts (like color) are inherited? 
                // No, getting computed styles for everything is too heavy.
                // Simpler: Just rely on the cloned node. 
                // BUT: Inherited fonts/colors might be lost if they were on a parent.
                // FIX: explicitly set color/font from computed style on the clone root.
                const computed = iframeWin.getComputedStyle(el);
                clone.style.color = computed.color;
                clone.style.font = computed.font;
                clone.style.lineHeight = computed.lineHeight;
                clone.style.textAlign = computed.textAlign;
                clone.style.textTransform = computed.textTransform;
                clone.style.letterSpacing = computed.letterSpacing;
                clone.style.whiteSpace = computed.whiteSpace;

                // Wrap in XML valid string
                const serializer = new XMLSerializer();
                const htmlString = serializer.serializeToString(clone);

                const svgString = `
                  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                    <foreignObject width="100%" height="100%">
                      <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${computed.fontSize}; color: ${computed.color};">
                        ${htmlString}
                      </div>
                    </foreignObject>
                  </svg>
                `;

                const img = new Image();
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(svgBlob);

                return new Promise((resolve) => {
                  img.onload = () => {
                    const canvas = document.createElement('canvas');
                    // Use 2x scale for Retina-like crispness
                    const scale = 2;
                    canvas.width = width * scale;
                    canvas.height = height * scale;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                      ctx.scale(scale, scale);
                      ctx.drawImage(img, 0, 0, width, height);
                      URL.revokeObjectURL(url);
                      resolve(canvas.toDataURL('image/png'));
                    } else {
                      resolve('');
                    }
                  };
                  img.onerror = () => {
                    URL.revokeObjectURL(url);
                    resolve('');
                  };
                  img.src = url;
                });
              } catch (e) {
                return Promise.resolve('');
              }
            };

            const renderTextToImage = (text: string, style: CSSStyleDeclaration, width: number, height: number): string => {
              // Deprecated in favor of snapshotElementToImage for complex cases
              // But keep as fallback for simple text if needed? No, removing to save space/confusion.
              return '';
            };

            const svgElementToImage = (svgEl: SVGElement, width: number, height: number): string => {
              try {
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgEl);
                const encoded = btoa(unescape(encodeURIComponent(svgString)));
                return `data:image/svg+xml;base64,${encoded}`;
              } catch (e) {
                return '';
              }
            };

            const svgElementToInlineSvg = (
              svgEl: SVGElement,
              sx: number,
              sy: number,
              sw: number,
              sh: number,
              style: CSSStyleDeclaration
            ): string => {
              try {
                const clone = svgEl.cloneNode(true) as SVGElement;
                const serializer = new XMLSerializer();
                const color = parseColor(style.color) || '#000000';
                const opacity = parseFloat(style.opacity);

                clone.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
                clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                clone.setAttribute('x', String(sx));
                clone.setAttribute('y', String(sy));
                clone.setAttribute('width', String(sw));
                clone.setAttribute('height', String(sh));
                clone.setAttribute('overflow', 'visible');
                clone.setAttribute('color', color);
                if (!clone.getAttribute('viewBox')) {
                  clone.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
                }
                if (!clone.getAttribute('preserveAspectRatio')) {
                  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                }
                if (opacity !== 1) {
                  clone.setAttribute('opacity', String(opacity));
                }

                const paintAttrs = ['fill', 'stroke', 'stop-color', 'flood-color'];
                [clone, ...Array.from(clone.querySelectorAll('*'))].forEach((node) => {
                  paintAttrs.forEach((attr) => {
                    if (node.getAttribute(attr) === 'currentColor') {
                      node.setAttribute(attr, color);
                    }
                  });

                  const styleAttr = node.getAttribute('style');
                  if (styleAttr?.includes('currentColor')) {
                    node.setAttribute('style', styleAttr.replace(/currentColor/g, color));
                  }
                });

                return serializer.serializeToString(clone);
              } catch (e) {
                return '';
              }
            };

            const canvasToImage = (canvas: HTMLCanvasElement): string => {
              try {
                return canvas.toDataURL('image/png');
              } catch (e) {
                return '';
              }
            };

            const isIconFont = (fontFamily: string) => {
              const lower = fontFamily.toLowerCase();
              return lower.includes('material icons') || lower.includes('material symbols') || lower.includes('fontawesome') || lower.includes('icon');
            };

            // --- BORDER RADIUS HELPERS ---

            type CornerRadius = { x: number; y: number };
            type BorderRadii = {
              tl: CornerRadius;
              tr: CornerRadius;
              br: CornerRadius;
              bl: CornerRadius;
            };

            const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < 0.01;

            const getVisualScale = (el: HTMLElement, rect: DOMRect = el.getBoundingClientRect()) => {
              const computed = iframeWin.getComputedStyle(el);
              const layoutW = el.offsetWidth || parseFloat(computed.width) || rect.width;
              const layoutH = el.offsetHeight || parseFloat(computed.height) || rect.height;
              return {
                x: layoutW > 0 ? rect.width / layoutW : 1,
                y: layoutH > 0 ? rect.height / layoutH : 1,
              };
            };

            const scaleCssPx = (value: string, scale: number) => {
              const num = parseFloat(value);
              if (!Number.isFinite(num) || !value.trim().endsWith('px')) return value;
              return `${num * scale}px`;
            };

            const hasAnyRadius = (radii: BorderRadii) => {
              return radii.tl.x > 0 || radii.tl.y > 0
                || radii.tr.x > 0 || radii.tr.y > 0
                || radii.br.x > 0 || radii.br.y > 0
                || radii.bl.x > 0 || radii.bl.y > 0;
            };

            const hasUniformRadii = (radii: BorderRadii) => {
              const { tl, tr, br, bl } = radii;
              return nearlyEqual(tl.x, tr.x) && nearlyEqual(tr.x, br.x) && nearlyEqual(br.x, bl.x)
                && nearlyEqual(tl.y, tr.y) && nearlyEqual(tr.y, br.y) && nearlyEqual(br.y, bl.y);
            };

            /** Parse per-corner border-radius from computed style */
            const parseBorderRadii = (
              style: CSSStyleDeclaration,
              w: number,
              h: number,
              scaleX = 1,
              scaleY = 1,
            ): BorderRadii => {
              const parsePart = (part: string | undefined, size: number, scale: number) => {
                if (!part || part === '0' || part === '0px') return 0;
                if (part.endsWith('%')) {
                  return parseFloat(part) / 100 * size;
                }
                return (parseFloat(part) || 0) * scale;
              };

              const parseCorner = (val: string | undefined): CornerRadius => {
                if (!val) return { x: 0, y: 0 };
                const parts = val.trim().split(/\s+/);
                const x = parsePart(parts[0], w, scaleX);
                const y = parsePart(parts[1] || parts[0], h, scaleY);
                return { x, y };
              };

              const radii = {
                tl: parseCorner(style.borderTopLeftRadius),
                tr: parseCorner(style.borderTopRightRadius),
                br: parseCorner(style.borderBottomRightRadius),
                bl: parseCorner(style.borderBottomLeftRadius),
              };

              // CSS scales all corner radii down together when adjacent radii
              // would exceed the box size. Mirror that before emitting SVG.
              const scale = Math.min(
                1,
                w / Math.max(radii.tl.x + radii.tr.x, 1),
                w / Math.max(radii.bl.x + radii.br.x, 1),
                h / Math.max(radii.tl.y + radii.bl.y, 1),
                h / Math.max(radii.tr.y + radii.br.y, 1),
              );

              if (scale < 1) {
                Object.values(radii).forEach((corner) => {
                  corner.x *= scale;
                  corner.y *= scale;
                });
              }

              return radii;
            };

            /** Generate SVG path data for a rectangle with per-corner radii */
            const roundedRectPath = (px: number, py: number, pw: number, ph: number,
              radii: BorderRadii): string => {
              const { tl, tr, br, bl } = radii;
              const arc = (r: CornerRadius, x: number, y: number) => {
                return r.x > 0 && r.y > 0 ? `A${r.x},${r.y} 0 0 1 ${x},${y}` : `L${x},${y}`;
              };
              return [
                `M${px + tl.x},${py}`,
                `H${px + pw - tr.x}`,
                arc(tr, px + pw, py + tr.y),
                `V${py + ph - br.y}`,
                arc(br, px + pw - br.x, py + ph),
                `H${px + bl.x}`,
                arc(bl, px, py + ph - bl.y),
                `V${py + tl.y}`,
                arc(tl, px + tl.x, py),
                'Z'
              ].join(' ');
            };

            /** Render the correct SVG shape for an element based on its border-radius */
            const renderShape = (
              sx: number, sy: number, sw: number, sh: number,
              radii: BorderRadii,
              fillAttr: string, strokeAttr: string, filterAttr: string, opacityAttr: string
            ): string => {
              const { tl, tr, br, bl } = radii;
              const allEqual = hasUniformRadii(radii);
              const minDim = Math.min(sw, sh);
              const isFullyRound = allEqual && tl.x >= minDim / 2 && tl.y >= minDim / 2;

              if (!hasAnyRadius(radii)) {
                return `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" ${fillAttr} ${strokeAttr} ${filterAttr} ${opacityAttr} />\n`;
              }

              if (isFullyRound && Math.abs(sw - sh) < 1 && nearlyEqual(tl.x, tl.y)) {
                // Perfect square with full radius → circle
                const cx = sx + sw / 2;
                const cy = sy + sh / 2;
                const r = sw / 2;
                return `<circle cx="${cx}" cy="${cy}" r="${r}" ${fillAttr} ${strokeAttr} ${filterAttr} ${opacityAttr} />\n`;
              }
              if (isFullyRound) {
                // Pill / capsule shape → rounded rect with rx = half the shorter side
                // (NOT an ellipse — that would distort the shape into an oval)
                const rx = minDim / 2;
                return `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${rx}" ry="${rx}" ${fillAttr} ${strokeAttr} ${filterAttr} ${opacityAttr} />\n`;
              }
              if (allEqual) {
                // Uniform rounded rect
                return `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${tl.x}" ry="${tl.y}" ${fillAttr} ${strokeAttr} ${filterAttr} ${opacityAttr} />\n`;
              }
              // Per-corner rounded rect
              const d = roundedRectPath(sx, sy, sw, sh, radii);
              return `<path d="${d}" ${fillAttr} ${strokeAttr} ${filterAttr} ${opacityAttr} />\n`;
            };

            /** Create a clipPath definition matching an element's shape (with border-radius) */
            const createShapeClip = (
              clipId: string, cx: number, cy: number, cw: number, ch: number,
              radii: BorderRadii
            ): string => {
              const { tl, tr, br, bl } = radii;
              const allEqual = hasUniformRadii(radii);
              if (!hasAnyRadius(radii)) {
                return `<clipPath id="${clipId}"><rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" /></clipPath>`;
              }
              if (allEqual) {
                return `<clipPath id="${clipId}"><rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="${tl.x}" ry="${tl.y}" /></clipPath>`;
              }
              const d = roundedRectPath(cx, cy, cw, ch, radii);
              return `<clipPath id="${clipId}"><path d="${d}" /></clipPath>`;
            };

            const hasActualOverflow = (el: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration, radii: BorderRadii) => {
              const clipsOverflow = style.overflow === 'hidden' || style.overflow === 'clip'
                || style.overflowX === 'hidden' || style.overflowY === 'hidden'
                || style.overflowX === 'clip' || style.overflowY === 'clip';
              if (!clipsOverflow || rect.width <= 0 || rect.height <= 0) return false;

              const childElements = Array.from(el.children);

              // border-radius + overflow hidden clips child painting at the corners even
              // when children are still inside the rectangular bounding box.
              if (hasAnyRadius(radii)) {
                for (const child of childElements) {
                  const childStyle = iframeWin.getComputedStyle(child);
                  if (childStyle.display === 'none' || childStyle.visibility === 'hidden') continue;
                  const childRect = child.getBoundingClientRect();
                  const touchesTopLeft = childRect.left < rect.left + radii.tl.x && childRect.top < rect.top + radii.tl.y;
                  const touchesTopRight = childRect.right > rect.right - radii.tr.x && childRect.top < rect.top + radii.tr.y;
                  const touchesBottomRight = childRect.right > rect.right - radii.br.x && childRect.bottom > rect.bottom - radii.br.y;
                  const touchesBottomLeft = childRect.left < rect.left + radii.bl.x && childRect.bottom > rect.bottom - radii.bl.y;
                  if (touchesTopLeft || touchesTopRight || touchesBottomRight || touchesBottomLeft) {
                    return true;
                  }
                }
              }

              if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
                return true;
              }

              for (const child of childElements) {
                const childStyle = iframeWin.getComputedStyle(child);
                if (childStyle.display === 'none' || childStyle.visibility === 'hidden') continue;
                const childRect = child.getBoundingClientRect();
                if (
                  childRect.left < rect.left - 1
                  || childRect.top < rect.top - 1
                  || childRect.right > rect.right + 1
                  || childRect.bottom > rect.bottom + 1
                ) {
                  return true;
                }
              }

              return false;
            };

            const walk = async (node: Node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                const style = iframeWin.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                // Use RELATIVE coordinates (relative to iframe's root element)
                // This ensures SVG viewBox starts at (0,0) instead of absolute screen position
                const x = rect.left - rootRect.left;
                const y = rect.top - rootRect.top;
                const w = rect.width;
                const h = rect.height;
                const visualScale = getVisualScale(el, rect);

                // Skip non-visual elements entirely
                const tag = el.tagName.toUpperCase();
                if (['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'BR', 'WBR', 'COL', 'COLGROUP'].includes(tag)) return;

                // Slightly less strict visibility check - we now trust our pre-pass somewhat, 
                // but still want to skip things that are truly gone.
                // However, things with 0px height might have children with height (overflow visible), 
                // so we MUST check scrollHeight or just let it pass if children are interesting.
                const isHidden = style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0;
                if (isHidden) return;

                // --- RASTERIZATION DISABLED ---
                // The foreignObject snapshot approach causes CORS errors with external resources.
                // Falling back to vector text rendering with robust font fallbacks.
                // TODO: Implement server-side rendering or canvas-based text-to-image without CORS issues.

                // Canvas (New!)
                if (el.tagName === 'CANVAS') {
                  const dataUrl = canvasToImage(el as HTMLCanvasElement);
                  if (dataUrl && w > 0 && h > 0) {
                    svgElements += `<image href="${dataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" />\n`;
                  }
                  return;
                }

                // Inline SVG icons should remain vector nodes. Exporting them as
                // data-url images makes many SVG/Figma importers drop the icon.
                if (el.tagName.toLowerCase() === 'svg') {
                  const inlineSvg = svgElementToInlineSvg(el as unknown as SVGElement, x, y, w, h, style);
                  if (inlineSvg && w > 0 && h > 0) {
                    svgElements += `${inlineSvg}\n`;
                  }
                  return;
                }

                // Images
                if (el.tagName === 'IMG' && w > 0 && h > 0) {
                  const img = el as HTMLImageElement;
                  let src = img.currentSrc || img.src;
                  if (src) {
                    src = toAbsoluteUrl(src);
                    const imgRadii = parseBorderRadii(style, w, h, visualScale.x, visualScale.y);
                    const hasRadius = hasAnyRadius(imgRadii);

                    let clipAttr = '';
                    if (hasRadius) {
                      const clipId = getUniqueId('img-clip');
                      defsContent += createShapeClip(clipId, x, y, w, h, imgRadii);
                      clipAttr = `clip-path="url(#${clipId})"`;
                    }

                    svgElements += `<image href="${src}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" ${clipAttr} />\n`;

                    // Border overlay
                    const imgBorderColor = parseColor(style.borderColor);
                    const imgBorderWidth = parseFloat(style.borderWidth) * ((visualScale.x + visualScale.y) / 2);
                    if (imgBorderColor && imgBorderWidth > 0) {
                      svgElements += renderShape(x, y, w, h, imgRadii, 'fill="none"', `stroke="${imgBorderColor}" stroke-width="${imgBorderWidth}"`, '', '');
                    }
                  }
                  return;
                }

                // Pseudo-elements (::before / ::after) - Simple handling for background images/content
                const beforeStyle = iframeWin.getComputedStyle(el, '::before');
                const afterStyle = iframeWin.getComputedStyle(el, '::after');

                const processPseudo = (pStyle: CSSStyleDeclaration, pType: string) => {
                  if (pStyle.content !== 'none' && pStyle.content !== '' && pStyle.display !== 'none') {
                    // This is very rudimentary because we can't easily get the rect of a pseudo element.
                    // We assume it likely overlays the parent or is small.
                    // For now, if it has a background image, we try to render it over the parent.
                    // Or if it is an icon font, we treat it like text.

                    // TODO: Robust pseudo-element positioning is hard without specific libraries.
                    // We will leave this as a placeholder for simple icon/bg detection if needed.
                    // Typically, if an element is just a container for a pseudo-icon, the element's rect is the icon's rect.

                    const bg = processBackground(pStyle);
                    if (bg && bg.startsWith('url(')) {
                      // Likely an icon
                      // svgElements += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}" />\n`;
                    }
                  }
                }
                processPseudo(beforeStyle, 'before');
                processPseudo(afterStyle, 'after');

                // --- IMPROVED RENDERING: Backgrounds, Borders, Overflow ---
                const fill = processBackground(style);
                const shadowFilter = processShadow(style);
                const radii = parseBorderRadii(style, w, h, visualScale.x, visualScale.y);

                // Per-side borders
                const borders = {
                  top:    { w: parseFloat(style.borderTopWidth || '0') * visualScale.y,    c: parseColor(style.borderTopColor) },
                  right:  { w: parseFloat(style.borderRightWidth || '0') * visualScale.x,  c: parseColor(style.borderRightColor) },
                  bottom: { w: parseFloat(style.borderBottomWidth || '0') * visualScale.y, c: parseColor(style.borderBottomColor) },
                  left:   { w: parseFloat(style.borderLeftWidth || '0') * visualScale.x,   c: parseColor(style.borderLeftColor) },
                };
                const sameBorderWidth = nearlyEqual(borders.top.w, borders.right.w)
                  && nearlyEqual(borders.right.w, borders.bottom.w)
                  && nearlyEqual(borders.bottom.w, borders.left.w);
                const sameBorderColor = borders.top.c === borders.right.c
                  && borders.right.c === borders.bottom.c
                  && borders.bottom.c === borders.left.c;
                const hasUniformBorder = sameBorderWidth && sameBorderColor && borders.top.w > 0 && borders.top.c;
                const hasAnyBorder = borders.top.w > 0 || borders.right.w > 0 || borders.bottom.w > 0 || borders.left.w > 0;

                // Background image url(...) support
                const bgImage = style.backgroundImage;
                let bgImageUrl = '';
                if (bgImage && bgImage !== 'none' && bgImage.includes('url(') && !bgImage.includes('gradient')) {
                  const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
                  if (urlMatch) bgImageUrl = toAbsoluteUrl(urlMatch[1]);
                }

                const opacityAttr = parseFloat(style.opacity) !== 1 ? `opacity="${style.opacity}"` : '';

                // Render element shape (fill + uniform border + shadow)
                if ((fill || hasUniformBorder || shadowFilter || bgImageUrl) && w > 0 && h > 0) {
                  const fillAttr = fill ? `fill="${fill}"` : 'fill="none"';
                  const uniformStrokeWidth = (borders.top.w + borders.right.w + borders.bottom.w + borders.left.w) / 4;
                  const strokeAttr = hasUniformBorder ? `stroke="${borders.top.c}" stroke-width="${uniformStrokeWidth}"` : '';
                  const filterAttr = shadowFilter || '';
                  svgElements += renderShape(x, y, w, h, radii, fillAttr, strokeAttr, filterAttr, opacityAttr);
                }

                // Background image (rendered after fill, clipped to element shape)
                if (bgImageUrl && w > 0 && h > 0) {
                  const hasRadius = hasAnyRadius(radii);
                  if (hasRadius) {
                    const imgClipId = getUniqueId('bg-clip');
                    defsContent += createShapeClip(imgClipId, x, y, w, h, radii);
                    svgElements += `<image href="${bgImageUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${imgClipId})" />\n`;
                  } else {
                    svgElements += `<image href="${bgImageUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" />\n`;
                  }
                }

                // Per-side borders (when sides differ)
                if (hasAnyBorder && !hasUniformBorder && w > 0 && h > 0) {
                  if (hasAnyRadius(radii)) {
                    const visibleBorders = [borders.top, borders.right, borders.bottom, borders.left].filter(border => border.w > 0 && border.c);
                    const strokeColor = visibleBorders[0]?.c;
                    const strokeWidth = visibleBorders.reduce((sum, border) => sum + border.w, 0) / Math.max(visibleBorders.length, 1);
                    if (strokeColor && strokeWidth > 0) {
                      svgElements += renderShape(x, y, w, h, radii, 'fill="none"', `stroke="${strokeColor}" stroke-width="${strokeWidth}"`, '', opacityAttr);
                    }
                  } else {
                    if (borders.top.w > 0 && borders.top.c)
                      svgElements += `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" stroke="${borders.top.c}" stroke-width="${borders.top.w}" />\n`;
                    if (borders.right.w > 0 && borders.right.c)
                      svgElements += `<line x1="${x + w}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${borders.right.c}" stroke-width="${borders.right.w}" />\n`;
                    if (borders.bottom.w > 0 && borders.bottom.c)
                      svgElements += `<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${borders.bottom.c}" stroke-width="${borders.bottom.w}" />\n`;
                    if (borders.left.w > 0 && borders.left.c)
                      svgElements += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + h}" stroke="${borders.left.c}" stroke-width="${borders.left.w}" />\n`;
                  }
                }

                // Only create a clipPath when hidden/clip overflow is actually clipping content.
                // CSS frameworks put overflow-hidden on many elements where it changes nothing;
                // exporting all of those as SVG clips creates a sea of Figma masks.
                const hasOverflowClip = hasActualOverflow(el, rect, style, radii);

                if (hasOverflowClip) {
                  const overflowClipId = getUniqueId('ov-clip');
                  defsContent += createShapeClip(overflowClipId, x, y, w, h, radii);
                  svgElements += `<g clip-path="url(#${overflowClipId})">\n`;
                }

                for (const child of Array.from(node.childNodes)) {
                  await walk(child);
                }

                if (hasOverflowClip) {
                  svgElements += `</g>\n`;
                }

              } else if (node.nodeType === Node.TEXT_NODE) {
                const originalText = node.textContent?.trim();
                if (!originalText || !node.parentElement) {
                  return;
                }

                // Filter garbage text
                const text = cleanText(originalText);
                if (!text) return; // If text was only garbage, skip

                const parentStyle = iframeWin.getComputedStyle(node.parentElement);
                const parentOpacity = parseFloat(parentStyle.opacity);
                const parentRect = node.parentElement.getBoundingClientRect();
                const textScale = getVisualScale(node.parentElement, parentRect);

                // Allow text if it was forced visible or is visible
                const isVisible = parentStyle.display !== 'none' && parentStyle.visibility !== 'hidden' && parentOpacity > 0;
                if (!isVisible) return;

                const parentClassName = typeof node.parentElement.className === 'string' ? node.parentElement.className : '';
                const isIcon = isIconFont(parentStyle.fontFamily) || parentClassName.includes('material-icons');

                // Pre-calculate exact text bounds using Range
                // This fixes the "Overlapping" bug where we used parentElement rect previously
                const range = iframeDoc.createRange();
                range.selectNode(node);
                const textRect = range.getBoundingClientRect();

                // VECTOR TEXT MODE (Rasterization disabled - CORS issue)
                if (textRect.width > 0 && textRect.height > 0) {
                  const color = parentStyle.color;
                  const fontSize = scaleCssPx(parentStyle.fontSize, textScale.y);
                  const fontWeight = parentStyle.fontWeight;
                  const fontStyle = parentStyle.fontStyle !== 'normal' ? `font-style="${parentStyle.fontStyle}"` : '';
                  const letterSpacing = parentStyle.letterSpacing !== 'normal' ? `letter-spacing="${scaleCssPx(parentStyle.letterSpacing, textScale.x)}"` : '';
                  const textDecoration = parentStyle.textDecorationLine !== 'none' ? `text-decoration="${parentStyle.textDecorationLine}"` : '';
                  const opacity = parentOpacity !== 1 ? `opacity="${parentOpacity}"` : '';

                  // Standardize Font Stack for maximum compatibility (Mac/Win/Figma)
                  let fontFamily = parentStyle.fontFamily.replace(/"/g, "'");

                  // Specific fix for Chinese text garbled (Tofu) -> Force system Chinese fonts
                  const hasChinese = /[\u4e00-\u9fff]/.test(text);
                  if (hasChinese) {
                    // Prepend common Chinese system fonts
                    // PingFang SC (Mac), Microsoft YaHei (Win), SimHei (Old Win), Heiti SC, Arial (Fallback)
                    fontFamily = `'PingFang SC', 'Microsoft YaHei', 'SimHei', 'Heiti SC', 'Arial', sans-serif`;
                  } else {
                    // For non-Chinese, ensure we have a safe fallback
                    if (!fontFamily.toLowerCase().includes('sans-serif') && !fontFamily.toLowerCase().includes('serif')) {
                      fontFamily += ', sans-serif';
                    }
                  }

                  // Clean up for SVG attribute
                  fontFamily = fontFamily.replace(/'/g, '');

                  // Use top-left positioning with proper baseline
                  // The textRect already gives us the visual bounds of the text
                  // We need to position text so its visual top matches textRect.top
                  const tx = textRect.left - rootRect.left;
                  const ty = textRect.top - rootRect.top;
                  const baselineOffset = textRect.height * 0.75;

                  svgElements += `<text
                             x="${tx}"
                             y="${ty + baselineOffset}"
                             fill="${color}"
                             font-family="${escapeXml(fontFamily)}"
                             font-size="${fontSize}"
                             font-weight="${fontWeight}"
                             ${fontStyle}
                             text-anchor="start"
                             ${letterSpacing}
                             ${textDecoration}
                             ${opacity}
                             xml:space="preserve">${escapeXml(text)}</text>\n`;
                }
              }
            };

            // Draw root/body background first
            const rootStyle = iframeWin.getComputedStyle(rootElement);
            const htmlEl = iframeDoc.documentElement;
            const htmlStyle = iframeWin.getComputedStyle(htmlEl);

            // Check both html and body for background
            let rootFill = processBackground(rootStyle) || processBackground(htmlStyle);

            // Fallback to white if no background detected
            if (!rootFill) {
              rootFill = '#ffffff';
            }

            if (rootFill) {
              svgElements = `<rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="${rootFill}" />\n` + svgElements;
            }

            // Walk the DOM tree
            console.log('[HTML2SVG] Starting DOM walk, root children:', rootElement.childNodes.length);
            for (const child of Array.from(rootElement.childNodes)) {
              await walk(child);
            }
            console.log('[HTML2SVG] Walk complete, svgElements length:', svgElements.length, 'defs length:', defsContent.length);

            const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by HTML2SVG Local Engine -->
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <defs>
    ${defsContent}
  </defs>
  ${svgElements}
</svg>`;

            // Clean up iframe to prevent memory leak
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }

            resolve(svg);

          } catch (e) {
            // Clean up iframe on error too
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
            reject(e);
          }
        });
      };

      iframe.onerror = (e) => {
        reject(new Error('Failed to load HTML in iframe'));
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      };

    } catch (e) {
      reject(e);
    }
  });
}; interface InheritedStyles {
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
}

/**
 * Converts SVG to HTML locally by mapping Rects, Texts, and Images to absolute positioned Divs.
 * Complex paths are preserved as embedded SVGs.
 * Handles style inheritance (fill, stroke, opacity) from <g> tags.
 */
export const convertSvgToHtmlLocal = async (svgInput: string): Promise<{ html: string; css: string }> => {
  return new Promise((resolve) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgInput, "image/svg+xml");
      const svg = doc.querySelector('svg');

      if (!svg) {
        resolve({ html: '<!-- Invalid SVG content -->', css: '' });
        return;
      }

      // --- HELPERS ---

      const escapeHtml = (unsafe: string) => {
        return unsafe
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      };

      const getAttributeOrStyle = (el: Element, attr: string): string | null => {
        let val = el.getAttribute(attr);
        if (val) return val;

        const style = el.getAttribute('style');
        if (style) {
          const match = style.match(new RegExp(`${attr}\\s*:\\s*([^;]+)`, 'i'));
          if (match) return match[1].trim();
        }
        return null;
      };

      const getVal = (val: string | null) => {
        if (!val) return '0px';
        if (val.match(/%|px|em|rem/)) return val;
        return `${val}px`;
      };

      // --- INIT CANVAS ---

      const widthAttr = getAttributeOrStyle(svg, 'width');
      const heightAttr = getAttributeOrStyle(svg, 'height');
      const viewBox = svg.getAttribute('viewBox');

      let w = '100%';
      let h = '100%';
      let viewBoxVal = '0 0 100 100';

      if (widthAttr) w = getVal(widthAttr);
      if (heightAttr) h = getVal(heightAttr);

      if (viewBox) {
        viewBoxVal = viewBox;
        const parts = viewBox.split(/\s+|,/).filter(Boolean).map(parseFloat);
        if (parts.length === 4) {
          const vbW = parts[2];
          const vbH = parts[3];
          if (!widthAttr) w = `${vbW}px`;
          if (!heightAttr) h = `${vbH}px`;
        }
      } else {
        // No viewBox - calculate from width/height
        const numW = parseFloat(widthAttr || '100');
        const numH = parseFloat(heightAttr || '100');
        viewBoxVal = `0 0 ${numW} ${numH}`;
      }

      // --- EXTRACT DEFS ---
      const defs = svg.querySelector('defs');
      let defsHtml = '';
      if (defs) {
        const serializer = new XMLSerializer();
        defsHtml = serializer.serializeToString(defs);
      }

      // --- EXTRACT ROOT STYLES FOR INHERITANCE ---
      const rootFill = getAttributeOrStyle(svg, 'fill');
      const rootStroke = getAttributeOrStyle(svg, 'stroke');
      const rootStrokeWidth = getAttributeOrStyle(svg, 'stroke-width');
      const rootFontFamily = getAttributeOrStyle(svg, 'font-family');
      const rootFontSize = getAttributeOrStyle(svg, 'font-size');
      const rootFontWeight = getAttributeOrStyle(svg, 'font-weight');

      const initialStyles: InheritedStyles = {
        fill: rootFill || undefined,
        stroke: rootStroke || undefined,
        strokeWidth: rootStrokeWidth || undefined,
        fontFamily: rootFontFamily || undefined,
        fontSize: rootFontSize || undefined,
        fontWeight: rootFontWeight || undefined
      };

      let outputHtml = '';

      const processElement = (el: Element, inherited: InheritedStyles = {}) => {
        const tag = el.tagName.toLowerCase();

        let x = getAttributeOrStyle(el, 'x') || '0';
        let y = getAttributeOrStyle(el, 'y') || '0';

        // Inheritable Attributes processing
        const ownFill = getAttributeOrStyle(el, 'fill');
        const ownStroke = getAttributeOrStyle(el, 'stroke');
        const ownStrokeWidth = getAttributeOrStyle(el, 'stroke-width');
        const ownFontFamily = getAttributeOrStyle(el, 'font-family');
        const ownFontSize = getAttributeOrStyle(el, 'font-size');
        const ownFontWeight = getAttributeOrStyle(el, 'font-weight');
        const opacity = getAttributeOrStyle(el, 'opacity') || getAttributeOrStyle(el, 'fill-opacity');
        const filter = getAttributeOrStyle(el, 'filter');
        const transform = getAttributeOrStyle(el, 'transform');

        // Calculate effective styles for children
        const currentStyles: InheritedStyles = {
          fill: ownFill !== null ? ownFill : inherited.fill,
          stroke: ownStroke !== null ? ownStroke : inherited.stroke,
          strokeWidth: ownStrokeWidth !== null ? ownStrokeWidth : inherited.strokeWidth,
          fontFamily: ownFontFamily !== null ? ownFontFamily : inherited.fontFamily,
          fontSize: ownFontSize !== null ? ownFontSize : inherited.fontSize,
          fontWeight: ownFontWeight !== null ? ownFontWeight : inherited.fontWeight,
        };

        let baseStyle = `position: absolute; left: ${getVal(x)}; top: ${getVal(y)};`;

        // --- 1. ForeignObject (HTML inside SVG) ---
        if (tag === 'foreignobject') {
          const width = getAttributeOrStyle(el, 'width');
          const height = getAttributeOrStyle(el, 'height');
          let style = `${baseStyle} width: ${getVal(width)}; height: ${getVal(height)}; overflow: hidden;`;
          outputHtml += `<div style="${style}">${el.innerHTML}</div>\n`;
          return;
        }

        // --- 2. GROUP (Recursive) ---
        if (tag === 'g') {
          // If group has visual effects (opacity, filter, transform), we MUST wrap it
          let groupWrapperStart = '';
          let groupWrapperEnd = '';

          if (opacity || filter || transform) {
            let groupStyle = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';
            if (opacity) groupStyle += ` opacity: ${opacity};`;
            if (!filter) {
              groupWrapperStart = `<div style="${groupStyle}">`;
              groupWrapperEnd = `</div>`;
            }
          }

          if (!filter) {
            if (groupWrapperStart) outputHtml += groupWrapperStart;
            Array.from(el.children).forEach(child => processElement(child, currentStyles));
            if (groupWrapperEnd) outputHtml += groupWrapperEnd;
            return;
          }
        }

        // --- 3. RECT (Simple) ---
        if (tag === 'rect') {
          const width = getAttributeOrStyle(el, 'width');
          const height = getAttributeOrStyle(el, 'height');
          const rx = getAttributeOrStyle(el, 'rx');

          const fillToUse = ownFill !== null ? ownFill : inherited.fill;
          const isComplexFill = fillToUse && fillToUse.includes('url(');

          if (!isComplexFill && !transform) {
            let style = `${baseStyle} width: ${getVal(width)}; height: ${getVal(height)};`;

            if (fillToUse && fillToUse !== 'none') style += ` background: ${fillToUse};`;
            if (rx) style += ` border-radius: ${getVal(rx)};`;

            const strokeToUse = ownStroke !== null ? ownStroke : inherited.stroke;
            const strokeW = (ownStrokeWidth !== null ? ownStrokeWidth : inherited.strokeWidth) || '1';

            if (strokeToUse && strokeToUse !== 'none') {
              style += ` border: ${getVal(strokeW)} solid ${strokeToUse}; box-sizing: border-box;`;
            }
            if (opacity) style += ` opacity: ${opacity};`;

            outputHtml += `  <div style="${style}"></div>\n`;
            return;
          }
        }

        // --- 4. TEXT ---
        if (tag === 'text') {
          const textAnchor = getAttributeOrStyle(el, 'text-anchor');
          const dominantBaseline = getAttributeOrStyle(el, 'dominant-baseline');
          const color = ownFill !== null ? ownFill : (inherited.fill || 'inherit');

          let style = `${baseStyle} color: ${color}; white-space: pre; line-height: 1; pointer-events: none;`;

          const fSize = ownFontSize || inherited.fontSize;
          const fFamily = ownFontFamily || inherited.fontFamily;
          const fWeight = ownFontWeight || inherited.fontWeight;

          if (fSize) style += ` font-size: ${getVal(fSize)};`;
          if (fFamily) style += ` font-family: ${fFamily};`;
          if (fWeight) style += ` font-weight: ${fWeight};`;
          if (opacity) style += ` opacity: ${opacity};`;

          const transforms: string[] = [];
          if (textAnchor === 'middle') transforms.push('translateX(-50%)');
          else if (textAnchor === 'end') transforms.push('translateX(-100%)');

          if (dominantBaseline === 'middle' || dominantBaseline === 'central') transforms.push('translateY(-50%)');
          else if (!dominantBaseline || dominantBaseline === 'auto') transforms.push('translateY(-80%)');

          if (transforms.length > 0) style += ` transform: ${transforms.join(' ')};`;

          outputHtml += `  <div style="${style}">${escapeHtml(el.textContent || '')}</div>\n`;
          return;
        }

        // --- 5. IMAGE ---
        if (tag === 'image') {
          const width = getAttributeOrStyle(el, 'width');
          const height = getAttributeOrStyle(el, 'height');
          const href = el.getAttribute('href') || el.getAttribute('xlink:href');

          let style = `${baseStyle} width: ${getVal(width)}; height: ${getVal(height)}; object-fit: cover;`;
          if (opacity) style += ` opacity: ${opacity};`;
          outputHtml += `  <img src="${href}" style="${style}" />\n`;
          return;
        }

        // --- DEFAULT: VECTOR LAYER ---
        // Handles paths, circles, complex rects, or groups with filters.
        // We wrap in a <g> to provide inherited styles explicitly to the SVG blob.

        const serializer = new XMLSerializer();
        let elString = serializer.serializeToString(el);

        // Construct inherited attributes string for the wrapper group
        let gAttrs = '';
        if (inherited.fill) gAttrs += ` fill="${inherited.fill}"`;
        if (inherited.stroke) gAttrs += ` stroke="${inherited.stroke}"`;
        if (inherited.strokeWidth) gAttrs += ` stroke-width="${inherited.strokeWidth}"`;
        if (inherited.fontFamily) gAttrs += ` font-family="${inherited.fontFamily}"`;
        if (inherited.fontSize) gAttrs += ` font-size="${inherited.fontSize}"`;
        if (inherited.fontWeight) gAttrs += ` font-weight="${inherited.fontWeight}"`;

        if (gAttrs) {
          elString = `<g ${gAttrs}>${elString}</g>`;
        }

        outputHtml += `
  <svg viewBox="${viewBoxVal}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;">
    ${elString}
  </svg>\n`;
      };

      Array.from(svg.children).forEach(child => {
        const tag = child.tagName.toLowerCase();
        if (tag !== 'defs' && tag !== 'style') {
          processElement(child, initialStyles);
        }
      });

      const result = `<!-- Generated by SVG2HTML Local Engine -->
<div style="
  position: relative; 
  width: ${w}; 
  height: ${h}; 
  background-color: transparent; 
  overflow: hidden;
">
  <!-- Global Defs -->
  <svg width="0" height="0" style="position:absolute; visibility:hidden;">
    ${defsHtml}
  </svg>
  ${outputHtml}
</div>`;

      resolve({ html: result, css: '' });
    } catch (e) {
      resolve({ html: `<!-- Error converting SVG locally: ${e} -->`, css: '' });
    }
  });
};
