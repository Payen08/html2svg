/**
 * Figma Design JSON Export Service
 *
 * Walks the rendered DOM in a hidden iframe and builds a structured JSON tree
 * that maps CSS properties to Figma node properties. This can be imported into
 * Figma plugins or used as an intermediate representation.
 *
 * Uses the same iframe rendering approach as localService.ts:
 * 1. Create hidden iframe
 * 2. Load HTML via srcdoc or directUrl
 * 3. Wait for Tailwind / scripts to finish rendering
 * 4. Walk DOM tree recursively, extracting visual + structural properties
 * 5. Return JSON tree
 * 6. Clean up iframe
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FigmaDesignNode {
  type: 'FRAME' | 'TEXT' | 'RECTANGLE' | 'IMAGE' | 'GROUP';
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  style: {
    fills: Array<{
      type: 'SOLID' | 'GRADIENT_LINEAR';
      color?: { r: number; g: number; b: number; a: number };
      gradientStops?: Array<{
        position: number;
        color: { r: number; g: number; b: number; a: number };
      }>;
      gradientAngle?: number;
    }>;
    cornerRadius: { tl: number; tr: number; br: number; bl: number };
    strokes?: Array<{
      color: { r: number; g: number; b: number; a: number };
      weight: number;
    }>;
    effects?: Array<{
      type: 'DROP_SHADOW';
      offset: { x: number; y: number };
      radius: number;
      color: { r: number; g: number; b: number; a: number };
    }>;
    opacity: number;
    clipsContent: boolean;
  };
  layout?: {
    mode: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
    primaryAlign: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
    counterAlign: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
    padding: { top: number; right: number; bottom: number; left: number };
    gap: number;
    sizing: {
      width: 'FIXED' | 'FILL' | 'HUG';
      height: 'FIXED' | 'FILL' | 'HUG';
    };
  };
  textStyle?: {
    content: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    color: { r: number; g: number; b: number; a: number };
    lineHeight: number;
    letterSpacing: number;
    textAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  };
  imageUrl?: string;
  children?: FigmaDesignNode[];
}

export interface FigmaDesignData {
  version: string;
  viewport: { width: number; height: number };
  tree: FigmaDesignNode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a CSS color string (rgb/rgba) into Figma 0-1 range */
function parseColorToFigma(colorStr: string): { r: number; g: number; b: number; a: number } | null {
  if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') {
    return null;
  }

  // Match rgba(r, g, b, a) or rgb(r, g, b)
  const rgbaMatch = colorStr.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)/
  );
  if (rgbaMatch) {
    return {
      r: parseFloat(rgbaMatch[1]) / 255,
      g: parseFloat(rgbaMatch[2]) / 255,
      b: parseFloat(rgbaMatch[3]) / 255,
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Match hex colors
  const hexMatch = colorStr.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
        a: parseInt(hex.substring(6, 8), 16) / 255,
      };
    }
  }

  return null;
}

/** Parse border-radius values from computed style */
function parseBorderRadii(
  style: CSSStyleDeclaration,
  w: number,
  h: number
): { tl: number; tr: number; br: number; bl: number } {
  const parse = (val: string | undefined) => {
    if (!val || val === '0px') return 0;
    const first = val.split(' ')[0];
    if (first.endsWith('%')) {
      return (parseFloat(first) / 100) * Math.min(w, h);
    }
    return parseFloat(first) || 0;
  };
  return {
    tl: parse(style.borderTopLeftRadius),
    tr: parse(style.borderTopRightRadius),
    br: parse(style.borderBottomRightRadius),
    bl: parse(style.borderBottomLeftRadius),
  };
}

/** Parse box-shadow into Figma DROP_SHADOW effect(s) */
function parseBoxShadow(
  style: CSSStyleDeclaration
): Array<{
  type: 'DROP_SHADOW';
  offset: { x: number; y: number };
  radius: number;
  color: { r: number; g: number; b: number; a: number };
}> {
  const shadow = style.boxShadow;
  if (!shadow || shadow === 'none') return [];

  const effects: Array<{
    type: 'DROP_SHADOW';
    offset: { x: number; y: number };
    radius: number;
    color: { r: number; g: number; b: number; a: number };
  }> = [];

  // Match individual shadow values (simplified - handles common cases)
  const colorMatch = shadow.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
  const numsMatch = shadow.match(/(-?\d+(?:\.\d+)?)px/g);

  if (colorMatch && numsMatch && numsMatch.length >= 2) {
    const color = parseColorToFigma(colorMatch[0]);
    if (color) {
      const dx = parseFloat(numsMatch[0]);
      const dy = parseFloat(numsMatch[1]);
      const blur = numsMatch.length > 2 ? parseFloat(numsMatch[2]) : 0;

      effects.push({
        type: 'DROP_SHADOW',
        offset: { x: dx, y: dy },
        radius: blur,
        color,
      });
    }
  }

  return effects;
}

/** Parse background into Figma fill(s) */
function parseBackgroundToFills(
  style: CSSStyleDeclaration
): FigmaDesignNode['style']['fills'] {
  const fills: FigmaDesignNode['style']['fills'] = [];

  // Check for gradient
  const bgImage = style.backgroundImage;
  if (bgImage && bgImage.includes('linear-gradient')) {
    let angle = 180;
    const angleMatch = bgImage.match(/(\d+)deg/);
    if (angleMatch) angle = parseInt(angleMatch[1]);

    const stopMatches = bgImage.match(
      /(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)\s*(\d+%|)/gi
    );

    if (stopMatches && stopMatches.length >= 2) {
      const gradientStops: Array<{
        position: number;
        color: { r: number; g: number; b: number; a: number };
      }> = [];

      stopMatches.forEach((stop, index) => {
        const parts = stop.match(
          /(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)\s*(\d+%)?/i
        );
        if (!parts) return;
        const color = parseColorToFigma(parts[1]);
        if (!color) return;
        const position = parts[2]
          ? parseFloat(parts[2]) / 100
          : index / (stopMatches.length - 1);
        gradientStops.push({ position, color });
      });

      if (gradientStops.length >= 2) {
        fills.push({
          type: 'GRADIENT_LINEAR',
          gradientStops,
          gradientAngle: angle,
        });
        return fills;
      }
    }
  }

  // Check for solid background color
  const bgColor = style.backgroundColor;
  if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
    const color = parseColorToFigma(bgColor);
    if (color) {
      fills.push({ type: 'SOLID', color });
    }
  }

  return fills;
}

/** Parse border to Figma stroke(s) */
function parseBorderToStrokes(
  style: CSSStyleDeclaration
): Array<{ color: { r: number; g: number; b: number; a: number }; weight: number }> {
  const strokes: Array<{
    color: { r: number; g: number; b: number; a: number };
    weight: number;
  }> = [];

  const borderWidth = parseFloat(style.borderWidth || '0');
  if (borderWidth > 0 && style.borderStyle !== 'none') {
    const borderColor = parseColorToFigma(style.borderColor);
    if (borderColor) {
      strokes.push({ color: borderColor, weight: borderWidth });
    }
  }

  return strokes;
}

/** Map CSS flexbox justify-content to Figma primaryAlign */
function mapJustifyContent(
  value: string
): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  switch (value) {
    case 'center':
      return 'CENTER';
    case 'flex-end':
    case 'end':
      return 'MAX';
    case 'space-between':
      return 'SPACE_BETWEEN';
    case 'flex-start':
    case 'start':
    default:
      return 'MIN';
  }
}

/** Map CSS flexbox align-items to Figma counterAlign */
function mapAlignItems(
  value: string
): 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' {
  switch (value) {
    case 'center':
      return 'CENTER';
    case 'flex-end':
    case 'end':
      return 'MAX';
    case 'stretch':
      return 'STRETCH';
    case 'flex-start':
    case 'start':
    default:
      return 'MIN';
  }
}

/** Map CSS text-align to Figma textAlign */
function mapTextAlign(
  value: string
): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
  switch (value) {
    case 'center':
      return 'CENTER';
    case 'right':
    case 'end':
      return 'RIGHT';
    case 'justify':
      return 'JUSTIFIED';
    default:
      return 'LEFT';
  }
}

/** Generate a meaningful name for a DOM element */
function getNodeName(el: HTMLElement): string {
  // Prefer id
  if (el.id) return el.id;

  // First meaningful class (skip utility classes)
  if (typeof el.className === 'string' && el.className.trim()) {
    const classes = el.className.trim().split(/\s+/);
    // Find first class that looks meaningful (not a single letter, not utility-like)
    const meaningful = classes.find(
      (c) => c.length > 2 && !c.includes(':') && !c.startsWith('-')
    );
    if (meaningful) return meaningful;
    return classes[0];
  }

  // Fall back to tag name
  return el.tagName.toLowerCase();
}

/** Convert a URL to absolute using a base URL */
function toAbsoluteUrl(url: string, baseUrl?: string): string {
  try {
    return new URL(url, baseUrl || 'http://localhost').href;
  } catch {
    return url;
  }
}

/** Determine sizing mode based on CSS width/height */
function determineSizing(
  style: CSSStyleDeclaration,
  dimension: 'width' | 'height'
): 'FIXED' | 'FILL' | 'HUG' {
  const value = style[dimension];
  const flexGrow = parseFloat(style.flexGrow || '0');

  if (value === '100%' || (flexGrow > 0 && dimension === 'width')) {
    return 'FILL';
  }
  if (value === 'auto' || value === 'fit-content' || value === 'max-content' || value === 'min-content') {
    return 'HUG';
  }
  return 'FIXED';
}

// ─── Main Export ───────────────────────────────────────────────────────────────

export async function exportToFigmaJSON(
  htmlInput: string,
  baseUrl?: string,
  directUrl?: string
): Promise<FigmaDesignData> {
  if (!htmlInput.trim()) {
    throw new Error('HTML input is empty');
  }

  return new Promise((resolve, reject) => {
    try {
      // 1. Create hidden iframe (same approach as localService.ts)
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '0px';
      iframe.style.left = '0px';
      iframe.style.width = '1440px';
      iframe.style.height = '900px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.zIndex = '-9999';
      iframe.style.border = 'none';

      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin'
      );

      document.body.appendChild(iframe);

      // 2. Load HTML
      if (directUrl) {
        iframe.src = directUrl;
      } else {
        let fullHtml = htmlInput;
        if (!fullHtml.toLowerCase().includes('<!doctype')) {
          fullHtml = '<!DOCTYPE html>\n' + fullHtml;
        }
        if (baseUrl) {
          if (/<head(\s[^>]*)?>/.test(fullHtml)) {
            fullHtml = fullHtml.replace(
              /<head(\s[^>]*)?>/,
              `<head$1><base href="${baseUrl}">`
            );
          } else if (/<html(\s[^>]*)?>/.test(fullHtml)) {
            fullHtml = fullHtml.replace(
              /<html(\s[^>]*)?>/,
              `<html$1><head><base href="${baseUrl}"></head>`
            );
          }
        }
        iframe.srcdoc = fullHtml;
      }

      // 3. Wait for load + scripts
      iframe.onload = () => {
        // Inject animation/transition override styles
        try {
          const style = iframe.contentDocument?.createElement('style');
          if (style) {
            style.textContent = `
              *, *::before, *::after {
                transition: none !important;
                animation: none !important;
                transition-property: none !important;
                transform: none !important;
              }
              [data-anim-tween], .fade-in, .reveal, .aos-animate {
                opacity: 1 !important;
                visibility: visible !important;
              }
            `;
            iframe.contentDocument?.head.appendChild(style);
          }
        } catch (e) {
          console.warn('Failed to inject override styles', e);
        }

        // Wait for Tailwind / CSS processing (same logic as localService.ts)
        const waitForTailwind = (): Promise<void> => {
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

                const styleSheets = iframeDoc.styleSheets;
                let hasTailwind = false;
                for (let i = 0; i < styleSheets.length; i++) {
                  try {
                    const sheet = styleSheets[i];
                    if (sheet.cssRules && sheet.cssRules.length > 100) {
                      hasTailwind = true;
                      break;
                    }
                  } catch {
                    // CORS errors for external stylesheets
                  }
                }

                const bodyStyle = iframeWin.getComputedStyle(iframeDoc.body);
                const bgColor = bodyStyle.backgroundColor;
                const hasBackground =
                  bgColor && bgColor !== 'rgba(0, 0, 0, 0)';

                if ((hasTailwind || hasBackground) && attempts >= 10) {
                  setTimeout(res, 300);
                  return;
                }

                if (attempts >= maxAttempts) {
                  res();
                  return;
                }

                setTimeout(checkReady, 100);
              } catch {
                if (attempts < maxAttempts) {
                  setTimeout(checkReady, 100);
                } else {
                  res();
                }
              }
            };

            setTimeout(checkReady, 500);
          });
        };

        waitForTailwind()
          .then(async () => {
            try {
              const iframeDoc = iframe.contentDocument;
              const iframeWin = iframe.contentWindow;

              if (!iframeDoc || !iframeWin) {
                reject(new Error('Cannot access iframe content'));
                return;
              }

              // Scroll to trigger lazy loading (same as localService.ts)
              const totalHeight = iframeDoc.body.scrollHeight;
              const viewportHeight = iframe.offsetHeight;
              for (let i = 0; i < totalHeight; i += viewportHeight) {
                iframeWin.scrollTo(0, i);
                await new Promise((r) => setTimeout(r, 50));
              }
              iframeWin.scrollTo(0, 0);
              await new Promise((r) => setTimeout(r, 300));

              // Reveal hidden content
              const allElements = iframeDoc.body.querySelectorAll('*');
              allElements.forEach((el) => {
                const st = iframeWin.getComputedStyle(el);
                if (parseFloat(st.opacity) < 0.1) {
                  if (
                    el.textContent?.trim() ||
                    el.tagName === 'IMG' ||
                    el.tagName === 'CANVAS' ||
                    el.tagName === 'SVG'
                  ) {
                    (el as HTMLElement).style.opacity = '1';
                    (el as HTMLElement).style.visibility = 'visible';
                  }
                }
              });

              const rootElement = iframeDoc.body;
              rootElement.getBoundingClientRect(); // Force layout

              const fullHeight = Math.max(
                rootElement.scrollHeight,
                rootElement.offsetHeight,
                iframeDoc.documentElement.offsetHeight
              );
              iframe.style.height = `${fullHeight}px`;

              const rootRect = rootElement.getBoundingClientRect();
              const svgWidth = Math.max(rootRect.width, 1440);
              const svgHeight = Math.max(rootRect.height, fullHeight, 900);

              // 4. Walk DOM tree recursively
              const walkElement = (el: HTMLElement): FigmaDesignNode | null => {
                const style = iframeWin.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                const x = rect.left - rootRect.left;
                const y = rect.top - rootRect.top;
                const w = rect.width;
                const h = rect.height;

                // Skip hidden elements
                if (
                  style.display === 'none' ||
                  style.visibility === 'hidden' ||
                  parseFloat(style.opacity) === 0
                ) {
                  return null;
                }

                // Skip zero-size elements with no children
                if (w === 0 && h === 0 && el.children.length === 0) {
                  return null;
                }

                // Determine node type
                const tagName = el.tagName.toLowerCase();
                let nodeType: FigmaDesignNode['type'] = 'FRAME';

                // Check if it's an image
                if (tagName === 'img') {
                  nodeType = 'IMAGE';
                }
                // Check if it's a text-only node (no element children, has text)
                else if (
                  el.children.length === 0 &&
                  el.textContent?.trim()
                ) {
                  nodeType = 'TEXT';
                }
                // Leaf with background but no text → RECTANGLE
                else if (
                  el.children.length === 0 &&
                  !el.textContent?.trim()
                ) {
                  const fills = parseBackgroundToFills(style);
                  if (fills.length > 0) {
                    nodeType = 'RECTANGLE';
                  } else {
                    nodeType = 'RECTANGLE';
                  }
                }
                // Has children → FRAME
                else {
                  nodeType = 'FRAME';
                }

                // Build the node
                const node: FigmaDesignNode = {
                  type: nodeType,
                  name: getNodeName(el),
                  bounds: { x, y, width: w, height: h },
                  style: {
                    fills: parseBackgroundToFills(style),
                    cornerRadius: parseBorderRadii(style, w, h),
                    opacity: parseFloat(style.opacity) || 1,
                    clipsContent:
                      style.overflow === 'hidden' ||
                      style.overflow === 'clip' ||
                      style.overflowX === 'hidden' ||
                      style.overflowY === 'hidden',
                  },
                };

                // Strokes
                const strokes = parseBorderToStrokes(style);
                if (strokes.length > 0) {
                  node.style.strokes = strokes;
                }

                // Effects (shadows)
                const effects = parseBoxShadow(style);
                if (effects.length > 0) {
                  node.style.effects = effects;
                }

                // Layout (flex)
                if (style.display === 'flex' || style.display === 'inline-flex') {
                  const flexDir = style.flexDirection;
                  node.layout = {
                    mode:
                      flexDir === 'row' || flexDir === 'row-reverse'
                        ? 'HORIZONTAL'
                        : flexDir === 'column' || flexDir === 'column-reverse'
                        ? 'VERTICAL'
                        : 'NONE',
                    primaryAlign: mapJustifyContent(style.justifyContent),
                    counterAlign: mapAlignItems(style.alignItems),
                    padding: {
                      top: parseFloat(style.paddingTop) || 0,
                      right: parseFloat(style.paddingRight) || 0,
                      bottom: parseFloat(style.paddingBottom) || 0,
                      left: parseFloat(style.paddingLeft) || 0,
                    },
                    gap: parseFloat(style.gap) || 0,
                    sizing: {
                      width: determineSizing(style, 'width'),
                      height: determineSizing(style, 'height'),
                    },
                  };
                } else if (
                  style.display === 'grid' ||
                  style.display === 'inline-grid'
                ) {
                  // Approximate grid as vertical layout
                  node.layout = {
                    mode: 'VERTICAL',
                    primaryAlign: 'MIN',
                    counterAlign: 'STRETCH',
                    padding: {
                      top: parseFloat(style.paddingTop) || 0,
                      right: parseFloat(style.paddingRight) || 0,
                      bottom: parseFloat(style.paddingBottom) || 0,
                      left: parseFloat(style.paddingLeft) || 0,
                    },
                    gap: parseFloat(style.gap) || parseFloat(style.rowGap) || 0,
                    sizing: {
                      width: determineSizing(style, 'width'),
                      height: determineSizing(style, 'height'),
                    },
                  };
                } else {
                  // Non-flex element: still capture padding for layout context
                  node.layout = {
                    mode: 'NONE',
                    primaryAlign: 'MIN',
                    counterAlign: 'MIN',
                    padding: {
                      top: parseFloat(style.paddingTop) || 0,
                      right: parseFloat(style.paddingRight) || 0,
                      bottom: parseFloat(style.paddingBottom) || 0,
                      left: parseFloat(style.paddingLeft) || 0,
                    },
                    gap: 0,
                    sizing: {
                      width: determineSizing(style, 'width'),
                      height: determineSizing(style, 'height'),
                    },
                  };
                }

                // Text style
                if (nodeType === 'TEXT') {
                  const textColor = parseColorToFigma(style.color);
                  const rawLetterSpacing = style.letterSpacing;
                  const letterSpacing =
                    rawLetterSpacing === 'normal'
                      ? 0
                      : parseFloat(rawLetterSpacing) || 0;

                  node.textStyle = {
                    content: el.textContent?.trim() || '',
                    fontFamily: style.fontFamily
                      .replace(/"/g, '')
                      .split(',')[0]
                      .trim(),
                    fontSize: parseFloat(style.fontSize) || 16,
                    fontWeight: parseInt(style.fontWeight) || 400,
                    color: textColor || { r: 0, g: 0, b: 0, a: 1 },
                    lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2,
                    letterSpacing,
                    textAlign: mapTextAlign(style.textAlign),
                  };
                }

                // Image URL
                if (nodeType === 'IMAGE' && tagName === 'img') {
                  const img = el as HTMLImageElement;
                  const src = img.currentSrc || img.src;
                  if (src) {
                    node.imageUrl = toAbsoluteUrl(src, baseUrl);
                  }
                }

                // Background image as IMAGE node content
                if (
                  nodeType !== 'IMAGE' &&
                  style.backgroundImage &&
                  style.backgroundImage !== 'none' &&
                  style.backgroundImage.includes('url(') &&
                  !style.backgroundImage.includes('gradient')
                ) {
                  const urlMatch = style.backgroundImage.match(
                    /url\(["']?([^"')]+)["']?\)/
                  );
                  if (urlMatch) {
                    node.imageUrl = toAbsoluteUrl(urlMatch[1], baseUrl);
                  }
                }

                // Process children (for FRAME nodes)
                if ((nodeType as string) === 'FRAME') {
                  const children: FigmaDesignNode[] = [];

                  for (const child of Array.from(el.childNodes)) {
                    if (child.nodeType === Node.ELEMENT_NODE) {
                      const childNode = walkElement(child as HTMLElement);
                      if (childNode) {
                        children.push(childNode);
                      }
                    } else if (child.nodeType === Node.TEXT_NODE) {
                      const text = child.textContent?.trim();
                      if (text) {
                        // Create a TEXT node for inline text
                        const parentStyle = iframeWin.getComputedStyle(el);
                        const textColor = parseColorToFigma(parentStyle.color);

                        // Get text bounds using Range
                        const range = iframeDoc.createRange();
                        range.selectNode(child);
                        const textRect = range.getBoundingClientRect();

                        if (textRect.width > 0 && textRect.height > 0) {
                          const rawLetterSpacing = parentStyle.letterSpacing;
                          const letterSpacing =
                            rawLetterSpacing === 'normal'
                              ? 0
                              : parseFloat(rawLetterSpacing) || 0;

                          children.push({
                            type: 'TEXT',
                            name: text.substring(0, 24).replace(/\s+/g, ' '),
                            bounds: {
                              x: textRect.left - rootRect.left,
                              y: textRect.top - rootRect.top,
                              width: textRect.width,
                              height: textRect.height,
                            },
                            style: {
                              fills: [],
                              cornerRadius: { tl: 0, tr: 0, br: 0, bl: 0 },
                              opacity: parseFloat(parentStyle.opacity) || 1,
                              clipsContent: false,
                            },
                            textStyle: {
                              content: text,
                              fontFamily: parentStyle.fontFamily
                                .replace(/"/g, '')
                                .split(',')[0]
                                .trim(),
                              fontSize:
                                parseFloat(parentStyle.fontSize) || 16,
                              fontWeight:
                                parseInt(parentStyle.fontWeight) || 400,
                              color: textColor || {
                                r: 0,
                                g: 0,
                                b: 0,
                                a: 1,
                              },
                              lineHeight:
                                parseFloat(parentStyle.lineHeight) ||
                                parseFloat(parentStyle.fontSize) * 1.2,
                              letterSpacing,
                              textAlign: mapTextAlign(
                                parentStyle.textAlign
                              ),
                            },
                          });
                        }
                      }
                    }
                  }

                  if (children.length > 0) {
                    node.children = children;
                  }
                }

                return node;
              };

              // Walk the root element
              const tree = walkElement(rootElement);

              if (!tree) {
                reject(new Error('Failed to build design tree from DOM'));
                return;
              }

              // Override root node name
              tree.name = 'Page';

              // 5. Build result
              const result: FigmaDesignData = {
                version: '1.0.0',
                viewport: {
                  width: svgWidth,
                  height: svgHeight,
                },
                tree,
              };

              // 6. Cleanup
              document.body.removeChild(iframe);

              resolve(result);
            } catch (err) {
              document.body.removeChild(iframe);
              reject(err);
            }
          })
          .catch((err) => {
            document.body.removeChild(iframe);
            reject(err);
          });
      };

      iframe.onerror = () => {
        document.body.removeChild(iframe);
        reject(new Error('Failed to load HTML content in iframe'));
      };
    } catch (err) {
      reject(err);
    }
  });
}
