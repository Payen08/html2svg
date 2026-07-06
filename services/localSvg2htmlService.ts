/**
 * Local SVG to HTML converter - Optimized for Figma exports
 * Converts SVG elements to their HTML/CSS equivalents without AI
 */

interface ConvertedElement {
    html: string;
    css: string;
}

interface ParsedSvgElement {
    tagName: string;
    attributes: Record<string, string>;
    textContent: string;
    children: ParsedSvgElement[];
    rawElement?: Element;
}

// Parse SVG string into structured data
function parseSvg(svgString: string): { parsed: ParsedSvgElement; doc: Document } | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    if (!svg) return null;

    function parseElement(el: Element): ParsedSvgElement {
        const attributes: Record<string, string> = {};
        for (const attr of el.attributes) {
            attributes[attr.name] = attr.value;
        }

        const children: ParsedSvgElement[] = [];
        for (const child of el.children) {
            children.push(parseElement(child));
        }

        // Get direct text content only (not from children)
        let textContent = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                textContent += node.textContent?.trim() || '';
            }
        }

        return {
            tagName: el.tagName.toLowerCase(),
            attributes,
            textContent,
            children,
            rawElement: el
        };
    }

    return { parsed: parseElement(svg), doc };
}

// Convert SVG color to CSS color
function convertColor(color: string): string {
    if (!color || color === 'none') return 'transparent';
    if (color.startsWith('url(')) return color;
    return color;
}

// Extract dimensions from SVG
function extractDimensions(svg: ParsedSvgElement): { width: number; height: number; viewBox: string } {
    const width = parseFloat(svg.attributes.width || '800');
    const height = parseFloat(svg.attributes.height || '600');
    const viewBox = svg.attributes.viewBox || `0 0 ${width} ${height}`;
    return { width, height, viewBox };
}

// Convert rect element to HTML div
function convertRect(el: ParsedSvgElement, index: number): ConvertedElement {
    const className = `rect-${index}`;
    const {
        x = '0',
        y = '0',
        width = '100',
        height = '50',
        rx = '0',
        ry,
        fill = 'transparent',
        stroke,
        'stroke-width': strokeWidth,
        opacity
    } = el.attributes;

    const borderRadius = ry ? `${rx}px ${ry}px` : `${rx}px`;
    const fillColor = convertColor(fill);

    let css = `.${className} {
  position: absolute;
  left: ${parseFloat(x)}px;
  top: ${parseFloat(y)}px;
  width: ${parseFloat(width)}px;
  height: ${parseFloat(height)}px;
  background: ${fillColor};
  border-radius: ${borderRadius};
  box-sizing: border-box;`;

    if (stroke && stroke !== 'none') {
        css += `
  border: ${strokeWidth || 1}px solid ${stroke};`;
    }

    if (opacity) {
        css += `
  opacity: ${opacity};`;
    }

    css += `
}`;

    return {
        html: `<div class="${className}"></div>`,
        css
    };
}

// Convert text element to HTML span
function convertText(el: ParsedSvgElement, index: number): ConvertedElement {
    const className = `text-${index}`;
    const {
        x = '0',
        y = '0',
        fill = '#000',
        'font-family': fontFamily = 'sans-serif',
        'font-size': fontSize = '16',
        'font-weight': fontWeight = 'normal',
        'text-anchor': textAnchor = 'start',
        opacity = '1'
    } = el.attributes;

    const fontSizeNum = parseFloat(fontSize.replace('px', ''));
    const adjustedY = parseFloat(y) - fontSizeNum * 0.8;

    let transform = 'translateY(0)';
    if (textAnchor === 'middle') {
        transform = 'translateX(-50%)';
    } else if (textAnchor === 'end') {
        transform = 'translateX(-100%)';
    }

    const css = `.${className} {
  position: absolute;
  left: ${x}px;
  top: ${adjustedY}px;
  color: ${convertColor(fill)};
  font-family: ${fontFamily};
  font-size: ${fontSizeNum}px;
  font-weight: ${fontWeight};
  opacity: ${opacity};
  transform: ${transform};
  white-space: nowrap;
  margin: 0;
  line-height: 1;
}`;

    return {
        html: `<span class="${className}">${el.textContent || ''}</span>`,
        css
    };
}

// Convert circle element
function convertCircle(el: ParsedSvgElement, index: number): ConvertedElement {
    const className = `circle-${index}`;
    const { cx = '50', cy = '50', r = '25', fill = '#ccc', stroke, 'stroke-width': strokeWidth } = el.attributes;

    const radius = parseFloat(r);
    const size = radius * 2;
    const left = parseFloat(cx) - radius;
    const top = parseFloat(cy) - radius;

    let css = `.${className} {
  position: absolute;
  left: ${left}px;
  top: ${top}px;
  width: ${size}px;
  height: ${size}px;
  background: ${convertColor(fill)};
  border-radius: 50%;`;

    if (stroke && stroke !== 'none') {
        css += `
  border: ${strokeWidth || 1}px solid ${stroke};`;
    }

    css += `
}`;

    return {
        html: `<div class="${className}"></div>`,
        css
    };
}

// Convert path element - render as inline SVG for accuracy
function convertPath(el: ParsedSvgElement, index: number, viewBox: string): ConvertedElement {
    const className = `path-${index}`;
    const d = el.attributes.d || '';
    const fill = el.attributes.fill || '#000';
    const stroke = el.attributes.stroke || 'none';
    const strokeWidth = el.attributes['stroke-width'] || '1';
    const strokeLinecap = el.attributes['stroke-linecap'] || 'butt';
    const strokeLinejoin = el.attributes['stroke-linejoin'] || 'miter';
    const opacity = el.attributes.opacity || '1';

    // Get bounding box from path data (approximate)
    const bounds = getPathBounds(d);

    // Create inline SVG for the path with proper viewBox
    const pathSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" style="width:100%;height:100%"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}"/></svg>`;

    const encoded = encodeURIComponent(pathSvg);

    const css = `.${className} {
  position: absolute;
  left: ${bounds.minX}px;
  top: ${bounds.minY}px;
  width: ${bounds.width}px;
  height: ${bounds.height}px;
  background-image: url("data:image/svg+xml,${encoded}");
  background-size: contain;
  background-repeat: no-repeat;
  opacity: ${opacity};
  pointer-events: none;
}`;

    return {
        html: `<div class="${className}"></div>`,
        css
    };
}

// Parse path data to get bounding box
function getPathBounds(d: string): { minX: number; minY: number; width: number; height: number } {
    // Extract all numbers from path data
    const numbers = d.match(/-?\d+\.?\d*/g)?.map(Number) || [];

    if (numbers.length < 2) {
        return { minX: 0, minY: 0, width: 100, height: 100 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    // Simple parsing - treat pairs as x,y coordinates
    for (let i = 0; i < numbers.length - 1; i += 2) {
        const x = numbers[i];
        const y = numbers[i + 1];
        if (!isNaN(x) && !isNaN(y)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    if (minX === Infinity) {
        return { minX: 0, minY: 0, width: 100, height: 100 };
    }

    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);

    return { minX, minY, width, height };
}

// Convert group element with opacity
function convertGroup(el: ParsedSvgElement, index: number, children: string[]): ConvertedElement {
    const className = `group-${index}`;
    const opacity = el.attributes.opacity || '1';

    const css = `.${className} {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  opacity: ${opacity};
}`;

    return {
        html: `<div class="${className}">\n${children.join('\n')}\n</div>`,
        css
    };
}

// Convert foreignObject to div
function convertForeignObject(el: ParsedSvgElement, index: number): ConvertedElement {
    const className = `foreign-${index}`;
    const { x = '0', y = '0', width = '100', height = '100' } = el.attributes;

    // Try to extract styles from inner div
    let backdropFilter = '';
    let clipPath = '';

    if (el.children.length > 0 && el.children[0].tagName === 'div') {
        const style = el.children[0].attributes.style || '';
        const blurMatch = style.match(/backdrop-filter:\s*blur\(([^)]+)\)/);
        if (blurMatch) {
            backdropFilter = `backdrop-filter: blur(${blurMatch[1]});`;
        }
        const clipMatch = style.match(/clip-path:\s*([^;]+)/);
        if (clipMatch) {
            clipPath = `clip-path: ${clipMatch[1]};`;
        }
    }

    const css = `.${className} {
  position: absolute;
  left: ${x}px;
  top: ${y}px;
  width: ${width}px;
  height: ${height}px;
  ${backdropFilter}
  ${clipPath}
}`;

    return {
        html: `<div class="${className}"></div>`,
        css
    };
}

// Convert mask element (simplified - just create a container)
function convertMask(el: ParsedSvgElement, index: number): ConvertedElement | null {
    // Masks are definitions, not rendered directly
    return null;
}

// Main conversion function
export async function convertSvgToHtmlLocal(svgInput: string): Promise<{ html: string; css: string }> {
    const result = parseSvg(svgInput);

    if (!result) {
        throw new Error('Invalid SVG format');
    }

    const { parsed, doc } = result;
    const dimensions = extractDimensions(parsed);
    const cssRules: string[] = [];
    const htmlElements: string[] = [];
    const gradients: Record<string, string> = {};
    const filters: Record<string, string> = {};

    let elementIndex = 0;

    // First pass: collect defs (gradients, filters)
    function collectDefs(el: ParsedSvgElement) {
        if (el.tagName === 'defs') {
            for (const child of el.children) {
                // Collect gradients
                if (child.tagName === 'lineargradient' || child.tagName === 'radialgradient') {
                    const id = child.attributes.id;
                    if (id) {
                        gradients[`url(#${id})`] = convertGradient(child);
                    }
                }
                // Collect filters for box-shadow conversion
                if (child.tagName === 'filter') {
                    const id = child.attributes.id;
                    if (id) {
                        filters[id] = convertFilterToShadow(child);
                    }
                }
            }
        }
        for (const child of el.children) {
            collectDefs(child);
        }
    }
    collectDefs(parsed);

    // Second pass: convert elements
    function processElement(el: ParsedSvgElement, parentGroupOpacity?: string): void {
        let converted: ConvertedElement | null = null;

        switch (el.tagName) {
            case 'rect':
                converted = convertRect(el, elementIndex++);
                break;
            case 'text':
                converted = convertText(el, elementIndex++);
                break;
            case 'circle':
                converted = convertCircle(el, elementIndex++);
                break;
            case 'path':
                converted = convertPath(el, elementIndex++, dimensions.viewBox);
                break;
            case 'foreignobject':
                converted = convertForeignObject(el, elementIndex++);
                break;
            case 'g':
                // Process group with children
                const groupIndex = elementIndex++;
                const groupChildren: string[] = [];
                const groupCssRules: string[] = [];

                for (const child of el.children) {
                    const childConverted = processElementAndReturn(child, el.attributes.opacity);
                    if (childConverted) {
                        groupChildren.push(childConverted.html);
                        groupCssRules.push(childConverted.css);
                    }
                }

                if (groupChildren.length > 0) {
                    const groupResult = convertGroup(el, groupIndex, groupChildren);
                    htmlElements.push(groupResult.html);
                    cssRules.push(groupResult.css);
                    cssRules.push(...groupCssRules);
                }
                return; // Don't process children again
            // Skip definition elements
            case 'svg':
            case 'defs':
            case 'lineargradient':
            case 'radialgradient':
            case 'stop':
            case 'filter':
            case 'feflood':
            case 'fecolormatrix':
            case 'feoffset':
            case 'fegaussianblur':
            case 'feblend':
            case 'fedropshadow':
            case 'clippath':
            case 'mask':
                break;
            default:
                // For unknown elements, try to convert as path if it has a 'd' attribute
                if (el.attributes.d) {
                    converted = convertPath(el, elementIndex++, dimensions.viewBox);
                }
        }

        if (converted) {
            // Apply gradient replacements
            let css = converted.css;
            for (const [ref, gradient] of Object.entries(gradients)) {
                css = css.replace(ref, gradient);
            }

            // Apply filter as box-shadow
            if (el.attributes.filter) {
                const filterMatch = el.attributes.filter.match(/url\(#([^)]+)\)/);
                if (filterMatch && filters[filterMatch[1]]) {
                    css = css.replace('}', `  ${filters[filterMatch[1]]}\n}`);
                }
            }

            cssRules.push(css);
            htmlElements.push(converted.html);
        }

        // Process children (except for groups which are handled above)
        if (el.tagName !== 'g') {
            for (const child of el.children) {
                processElement(child, parentGroupOpacity);
            }
        }
    }

    // Helper to process and return result
    function processElementAndReturn(el: ParsedSvgElement, parentOpacity?: string): ConvertedElement | null {
        let converted: ConvertedElement | null = null;

        switch (el.tagName) {
            case 'rect':
                converted = convertRect(el, elementIndex++);
                break;
            case 'text':
                converted = convertText(el, elementIndex++);
                break;
            case 'circle':
                converted = convertCircle(el, elementIndex++);
                break;
            case 'path':
                converted = convertPath(el, elementIndex++, dimensions.viewBox);
                break;
            case 'foreignobject':
                converted = convertForeignObject(el, elementIndex++);
                break;
            default:
                if (el.attributes.d) {
                    converted = convertPath(el, elementIndex++, dimensions.viewBox);
                }
        }

        if (converted) {
            // Apply gradient replacements
            let css = converted.css;
            for (const [ref, gradient] of Object.entries(gradients)) {
                css = css.replace(ref, gradient);
            }
            converted.css = css;
        }

        return converted;
    }

    processElement(parsed);

    // Build final HTML
    const containerCss = `.svg-container {
  position: relative;
  width: ${dimensions.width}px;
  height: ${dimensions.height}px;
  overflow: hidden;
  background: white;
}

* {
  box-sizing: border-box;
}`;

    const allCss = [containerCss, ...cssRules].join('\n\n');

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converted from SVG (Figma Export)</title>
  <style>
${allCss}
  </style>
</head>
<body style="margin: 0; padding: 20px; background: #f5f5f5;">
  <div class="svg-container">
${htmlElements.map(el => '    ' + el).join('\n')}
  </div>
</body>
</html>`;

    return {
        html: fullHtml,
        css: allCss
    };
}

// Convert gradient to CSS
function convertGradient(el: ParsedSvgElement): string {
    const stops = el.children.filter(c => c.tagName === 'stop');
    if (stops.length === 0) return 'transparent';

    const colorStops = stops.map(stop => {
        let color = stop.attributes['stop-color'] || '#000';
        const opacity = stop.attributes['stop-opacity'];
        if (opacity && parseFloat(opacity) < 1) {
            // Convert to rgba
            color = hexToRgba(color, parseFloat(opacity));
        }
        const offset = stop.attributes.offset || '0%';
        return `${color} ${offset}`;
    }).join(', ');

    if (el.tagName === 'lineargradient') {
        const x1 = parseFloat(el.attributes.x1 || '0');
        const y1 = parseFloat(el.attributes.y1 || '0');
        const x2 = parseFloat(el.attributes.x2 || '100');
        const y2 = parseFloat(el.attributes.y2 || '100');

        const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI + 90;
        return `linear-gradient(${angle}deg, ${colorStops})`;
    }

    return `radial-gradient(circle, ${colorStops})`;
}

// Convert hex to rgba
function hexToRgba(hex: string, alpha: number): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
        const r = parseInt(result[1], 16);
        const g = parseInt(result[2], 16);
        const b = parseInt(result[3], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hex;
}

// Convert filter to CSS box-shadow
function convertFilterToShadow(el: ParsedSvgElement): string {
    // Look for feDropShadow or feGaussianBlur + feOffset combination
    for (const child of el.children) {
        if (child.tagName === 'fedropshadow') {
            const dx = child.attributes.dx || '0';
            const dy = child.attributes.dy || '0';
            const stdDev = child.attributes.stdDeviation || '3';
            const opacity = child.attributes['flood-opacity'] || '0.1';
            return `box-shadow: ${dx}px ${dy}px ${parseFloat(stdDev) * 2}px rgba(0, 0, 0, ${opacity});`;
        }

        if (child.tagName === 'fegaussianblur') {
            const stdDev = child.attributes.stdDeviation || '0';
            // This is a blur filter, return as backdrop-filter or box-shadow
            return `box-shadow: 0 0 ${parseFloat(stdDev) * 2}px rgba(0, 0, 0, 0.1);`;
        }
    }

    return '';
}
