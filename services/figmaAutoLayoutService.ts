import type { ConvertResult } from '@figit/dom-to-figma';

type NativeNode = ConvertResult['document']['nodeChanges'][number] & {
    stackChildPrimaryGrow?: number; stackChildAlignSelf?: string; stackPositioning?: string;
};
type Sizing = 'HUG' | 'FILL' | 'FIXED';
const guidKey = (guid: { sessionID: number; localID: number }) => `${guid.sessionID}:${guid.localID}`;
const px = (value: string) => Number.parseFloat(value) || 0;
const align = (value: string) => /baseline/.test(value) ? 'BASELINE' : /center/.test(value) ? 'CENTER' : /end|right/.test(value) ? 'MAX' : 'MIN';

/** Typed OM preserves auto/percent sizes, unlike getComputedStyle's resolved pixels. */
function declaredSize(element: Element, axis: 'width' | 'height'): string {
    const captured = element.getAttribute(`data-html2svg-sizing-${axis}`);
    if (captured) return captured;
    const typed = (element as HTMLElement & { computedStyleMap?: () => Map<string, unknown> }).computedStyleMap?.().get(axis);
    return typed?.toString() || (element as HTMLElement).style?.getPropertyValue(axis) || 'auto';
}

/** Enforce native stack rules from DOM structure, including the library's absolute fallbacks. */
export function applyFigmaAutoLayout(root: HTMLElement, result: ConvertResult): void {
    const nodes = result.document.nodeChanges as NativeNode[];
    const traces = new Map(result.trace?.entries.map(entry => [guidKey(entry.guid), entry]));
    const elements = new Map<string, Element>();
    const sourceNodes = new Map<string, Node>();
    const children = new Map<string, NativeNode[]>();
    const styles = new Map<Element, CSSStyleDeclaration>();
    const sizingOverrides = new Map<string, { width: Sizing; height: Sizing }>();
    let nextId = Math.max(...nodes.map(node => node.guid.localID)) + 1;
    const styleOf = (element: Element) => {
        let style = styles.get(element);
        if (!style) { style = root.ownerDocument.defaultView!.getComputedStyle(element); styles.set(element, style); }
        return style;
    };
    for (const node of nodes) {
        const trace = traces.get(guidKey(node.guid));
        if (trace) {
            const path = trace.domPath.replace(/::text\[\d+\]$/, '');
            const element = path === ':scope' ? root : root.querySelector(path);
            if (element) {
                elements.set(guidKey(node.guid), element);
                const textIndex = trace.domPath.match(/::text\[(\d+)\]$/)?.[1];
                sourceNodes.set(guidKey(node.guid), textIndex === undefined ? element : element.childNodes[Number(textIndex)] || element);
            }
        }
        if (node.parentIndex) {
            const key = guidKey(node.parentIndex.guid);
            const bucket = children.get(key) || [];
            bucket.push(node);
            children.set(key, bucket);
        }
    }
    const policy = (node: NativeNode, element: Element | undefined, axis: 'width' | 'height', parent?: Element): Sizing => {
        const override = sizingOverrides.get(guidKey(node.guid));
        if (override) return override[axis];
        if (!element) return node.type === 'TEXT' ? 'HUG' : 'FIXED';
        const style = styleOf(element);
        // Direct text is an anonymous flex/inline item, not its owner's entire box.
        const directText = node.type === 'TEXT' && traces.get(guidKey(node.guid))?.tag === '#text';
        if (directText && element === parent) {
            if (axis === 'height') return 'HUG';
            if (/^(INPUT|TEXTAREA)$/.test(element.tagName)) return 'FILL';
            if (/^(block|table-cell)$/.test(style.display) ||
                (style.display.includes('flex') && style.flexDirection.startsWith('column') && /stretch|normal/.test(style.alignItems))) return 'FILL';
            return 'HUG';
        }
        const size = declaredSize(element, axis);
        const maximum = axis === 'width' ? style.maxWidth : style.maxHeight;
        const measured = traces.get(guidKey(node.guid))?.rect[axis];
        if (node.type === 'FRAME' && /px$/.test(maximum || '') && measured !== undefined && measured >= px(maximum) - 0.5) return 'FIXED';
        // inset-constrained absolute boxes derive their size from both edges,
        // even though CSS width/height is auto. Hug would move MAX anchors.
        const startInset = axis === 'width' ? style.left : style.top;
        const endInset = axis === 'width' ? style.right : style.bottom;
        if (/^(absolute|fixed)$/.test(style.position) && startInset && endInset && startInset !== 'auto' && endInset !== 'auto') return 'FIXED';
        if (/^100(?:\.0+)?%$/.test(size)) return 'FILL';
        if (!/^(auto|min-content|max-content|fit-content)(\(|$)/.test(size)) return 'FIXED';
        if (node.type === 'TEXT' && axis === 'height') return 'HUG';
        const parentStyle = parent && styleOf(parent);
        if (parentStyle?.display.includes('flex')) {
            const mainAxis = parentStyle.flexDirection.startsWith('row') ? 'width' : 'height';
            if (axis === mainAxis) {
                // A sole shrinkable text column beside fixed icons needs the
                // remaining row width, so long labels can wrap after resizing.
                const textColumn = axis === 'width' && style.display.includes('flex') && style.flexDirection.startsWith('column') && px(style.flexShrink) > 0 &&
                    /^(normal|flex-start|start)$/.test(parentStyle.justifyContent) &&
                    Array.from(parent!.children || []).filter(child => {
                        const css = styleOf(child);
                        return css.display.includes('flex') && css.flexDirection.startsWith('column');
                    }).length === 1;
                return px(style.flexGrow) > 0 || textColumn ? 'FILL' : 'HUG';
            }
            const selfAlign = style.alignSelf === 'auto' ? parentStyle.alignItems : style.alignSelf;
            return /stretch|normal/.test(selfAlign) ? 'FILL' : 'HUG';
        }
        if (axis === 'height') return 'HUG';
        if (element.tagName === 'BUTTON' || /inline/.test(style.display)) return 'HUG';
        return 'FILL';
    };

    const rootNode = result.trace && nodes.find(node => guidKey(node.guid) === guidKey(result.trace!.rootGuid));
    if (rootNode?.type === 'FRAME') {
        // Fixed-position application shells can have a zero-height DOM mount.
        // Hugging that mount would collapse the captured viewport on paste.
        Object.assign(rootNode, { stackMode: 'VERTICAL', stackSpacing: 0, stackPrimarySizing: 'FIXED', stackCounterSizing: 'FIXED' });
    }
    // First give every content container its own layout and sizing, independently of its parent.
    for (const node of nodes) {
        if (node.type !== 'FRAME') continue;
        const element = elements.get(guidKey(node.guid));
        const childNodes = children.get(guidKey(node.guid)) || [];
        if (element?.namespaceURI === 'http://www.w3.org/2000/svg') {
            // Tight path bounds exclude half the stroke; SVG geometry frames must not clip.
            node.frameMaskDisabled = true;
            const pending = [...childNodes];
            while (pending.length) {
                const descendant = pending.pop()!;
                if (descendant.type === 'FRAME') descendant.frameMaskDisabled = true;
                pending.push(...(children.get(guidKey(descendant.guid)) || []));
            }
            continue;
        }
        if (!element || !childNodes.length) continue;
        const style = styleOf(element);
        node.name = element.getAttribute('data-figma-name') || element.id ||
            (element.tagName === 'BUTTON' ? `Button / ${(element.textContent || '').trim().slice(0, 60)}` : node.name);
        const parentElement = node.parentIndex && elements.get(guidKey(node.parentIndex.guid));
        const flow = childNodes.filter(child => {
            const childElement = elements.get(guidKey(child.guid));
            // Exporter-generated border vectors are decorations, never stack items.
            if (!childElement) return child.type === 'TEXT';
            return childElement === element || !/^(absolute|fixed)$/.test(styleOf(childElement).position);
        });
        const grid = style.display.includes('grid');
        // Block text can mix anonymous text runs with inline emphasis/units.
        // Its CSS formatting context is still one baseline-aligned line.
        const inlineTextFlow = !grid && !style.display.includes('flex') && flow.length > 1 && flow.every(child => {
            const owner = elements.get(guidKey(child.guid));
            return child.type === 'TEXT' && owner === element || owner && owner !== element && styleOf(owner).display === 'inline';
        });
        if (inlineTextFlow) for (const child of flow) {
            if (child.type === 'TEXT') sizingOverrides.set(guidKey(child.guid), {width:'HUG',height:'HUG'});
        }
        const row = style.display.includes('flex') ? style.flexDirection.startsWith('row') :
            grid ? style.gridTemplateColumns.trim().split(/\s+/).length > 1 :
                /^(BUTTON|TR)$/.test(element.tagName) || /inline/.test(style.display) || inlineTextFlow;
        node.stackMode = row ? 'HORIZONTAL' : 'VERTICAL';
        node.stackHorizontalPadding = px(style.paddingLeft) + px(style.borderLeftWidth);
        node.stackVerticalPadding = px(style.paddingTop) + px(style.borderTopWidth);
        node.stackPaddingRight = px(style.paddingRight) + px(style.borderRightWidth);
        node.stackPaddingBottom = px(style.paddingBottom) + px(style.borderBottomWidth);
        // Negative child margins cancel ancestor padding in browser layouts (page shells).
        // Encode the effective inset once rather than keeping both layers of spacing.
        if (flow.length === 1) {
            const childElement = elements.get(guidKey(flow[0].guid));
            if (childElement && childElement !== element) {
                const childStyle = styleOf(childElement);
                const pairs = [['marginLeft', 'stackHorizontalPadding'], ['marginRight', 'stackPaddingRight'], ['marginTop', 'stackVerticalPadding'], ['marginBottom', 'stackPaddingBottom']] as const;
                for (const [margin, padding] of pairs) {
                    const value = px(childStyle[margin]);
                    if (value >= 0) continue;
                    const cssPadding = padding === 'stackHorizontalPadding' ? 'paddingLeft' : padding === 'stackPaddingRight' ? 'paddingRight' : padding === 'stackVerticalPadding' ? 'paddingTop' : 'paddingBottom';
                    let remaining = -value;
                    let current: NativeNode | undefined = node;
                    while (current && remaining > 0) {
                        const owner = elements.get(guidKey(current.guid));
                        if (!owner) break;
                        const available = Math.min(Number(current[padding]) || 0, px(styleOf(owner)[cssPadding]));
                        const consumed = Math.min(remaining, available);
                        current[padding] = (Number(current[padding]) || 0) - consumed;
                        remaining -= consumed;
                        if (consumed > 0) {
                            const sizing = sizingOverrides.get(guidKey(flow[0].guid)) || {
                                width: policy(flow[0], childElement, 'width', element), height: policy(flow[0], childElement, 'height', element),
                            };
                            const axis = /Left|Right/.test(margin) ? 'width' : 'height';
                            // calc(100% + margins) becomes Fill once the cancelled
                            // inset is removed, rather than a frozen pixel box.
                            if (declaredSize(childElement, axis).startsWith('calc(')) sizing[axis] = 'FILL';
                            sizingOverrides.set(guidKey(flow[0].guid), sizing);
                        }
                        const parent = current.parentIndex && nodes.find(candidate => guidKey(candidate.guid) === guidKey(current!.parentIndex!.guid));
                        if (!parent || parent.type !== 'FRAME') break;
                        const siblings = (children.get(guidKey(parent.guid)) || []).filter(candidate => {
                            const sibling = elements.get(guidKey(candidate.guid));
                            return sibling && !/^(absolute|fixed)$/.test(styleOf(sibling).position);
                        });
                        // Only cross shells with one flow item: never remove
                        // shared page padding around unrelated siblings.
                        if (siblings.length !== 1 || siblings[0] !== current) break;
                        current = parent;
                    }
                }
            }
        }
        // Reserve the visible scrollbar gutter instead of stretching content into it.
        if (/auto|scroll/.test(style.overflowY) && 'offsetWidth' in element) {
            const gutter = (element as HTMLElement).offsetWidth - element.clientWidth - px(style.borderLeftWidth) - px(style.borderRightWidth);
            if (gutter > 0) node.stackPaddingRight += gutter;
        }
        node.stackPrimaryAlignItems = style.justifyContent === 'space-between' ? 'SPACE_BETWEEN' : align(style.justifyContent);
        node.stackCounterAlignItems = inlineTextFlow ? 'BASELINE' : element.tagName === 'BUTTON' ? 'CENTER' : align(style.alignItems);
        const wrapping = row && (grid || style.flexWrap === 'wrap');
        node.stackWrap = wrapping ? 'WRAP' : 'NO_WRAP';
        node.stackCounterSpacing = wrapping ? px(style.rowGap) : 0;
        const width = policy(node, element, 'width', parentElement);
        const height = policy(node, element, 'height', parentElement);
        node.stackPrimarySizing = (row ? width : height) === 'HUG' && node.stackPrimaryAlignItems !== 'SPACE_BETWEEN' ? 'RESIZE_TO_FIT' : 'FIXED';
        node.stackCounterSizing = (row ? height : width) === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED';
        // Hug cannot derive a box from absolute children. Keep the measured
        // containing block so bottom/right anchors retain their captured origin.
        if (!flow.length && childNodes.length) {
            node.stackPrimarySizing = 'FIXED';
            node.stackCounterSizing = 'FIXED';
        }
        const minWidth = /px$/.test(style.minWidth || '') ? px(style.minWidth) : 0;
        const minHeight = /px$/.test(style.minHeight || '') ? px(style.minHeight) : 0;
        if (minWidth || minHeight) Object.assign(node, { minSize: { value: { x: minWidth, y: minHeight } } });
        flow.sort((a, b) => {
            const aElement = elements.get(guidKey(a.guid));
            const bElement = elements.get(guidKey(b.guid));
            const aNode = sourceNodes.get(guidKey(a.guid));
            const bNode = sourceNodes.get(guidKey(b.guid));
            if (!aElement || !bElement || !aNode || !bNode || aNode === bNode) return Number(a.parentIndex?.position) - Number(b.parentIndex?.position);
            const aOrder = aElement === element ? 0 : px(styleOf(aElement).order);
            const bOrder = bElement === element ? 0 : px(styleOf(bElement).order);
            return aOrder - bOrder || (aNode.compareDocumentPosition(bNode) & 4 ? -1 : 1);
        });
        if (style.flexDirection.endsWith('reverse')) flow.reverse();
        // Block containers may contain an inline control row (e.g. modal actions).
        // Preserve that row as a nested horizontal stack instead of piling it up.
        if (!row && !grid && !style.display.includes('flex')) {
            const inline = (child: NativeNode) => {
                const owner = elements.get(guidKey(child.guid));
                return owner && owner !== element && styleOf(owner).display.startsWith('inline');
            };
            for (let start = 0; start < flow.length; start++) {
                if (!inline(flow[start])) continue;
                let end = start + 1;
                while (end < flow.length && inline(flow[end])) end++;
                if (end - start < 2) continue;
                const run = flow.slice(start, end);
                const rects = run.map(child => traces.get(guidKey(child.guid))?.rect);
                if (rects.some(rect => !rect)) continue;
                const left = Math.min(...rects.map(rect => rect!.x));
                const top = Math.min(...rects.map(rect => rect!.y));
                const right = Math.max(...rects.map(rect => rect!.x + rect!.width));
                const bottom = Math.max(...rects.map(rect => rect!.y + rect!.height));
                const gaps = rects.slice(1).map((rect, index) => rect!.x - rects[index]!.x - rects[index]!.width).filter(gap => gap >= 0);
                const wrapper: NativeNode = {
                    type: 'FRAME', phase: 'CREATED', guid: {sessionID: node.guid.sessionID, localID: nextId++},
                    name: 'Inline controls', visible: true, opacity: 1, fillPaints: [], frameMaskDisabled: true,
                    parentIndex: {guid: node.guid, position: run[0].parentIndex!.position},
                    size: {x: right - left, y: bottom - top},
                    stackMode: 'HORIZONTAL', stackWrap: 'WRAP', stackSpacing: gaps.length ? Math.min(...gaps) : 0,
                    stackCounterSpacing: 4, stackPrimarySizing: 'FIXED', stackCounterSizing: 'RESIZE_TO_FIT',
                    stackPrimaryAlignItems: 'MIN', stackCounterAlignItems: 'CENTER', stackPositioning: 'AUTO',
                };
                const first = traces.get(guidKey(run[0].guid))!;
                traces.set(guidKey(wrapper.guid), {...first, guid: wrapper.guid, rect: {x: left, y: top, width: right - left, height: bottom - top}});
                sizingOverrides.set(guidKey(wrapper.guid), {width: 'FILL', height: 'HUG'});
                run.forEach((child, index) => {child.parentIndex = {guid: wrapper.guid, position: String(index).padStart(6,'0')}; child.stackPositioning = 'AUTO';});
                flow.splice(start, run.length, wrapper);
                const insertion = childNodes.indexOf(run[0]);
                run.forEach(child => { const index = childNodes.indexOf(child); if (index >= 0) childNodes.splice(index, 1); });
                childNodes.splice(Math.min(insertion, childNodes.length), 0, wrapper);
                children.set(guidKey(wrapper.guid), run);
                nodes.push(wrapper);
            }
        }

        const gap = row ? style.columnGap : style.rowGap;
        const measuredGaps = flow.slice(1).map((child, index) => {
            const previous = traces.get(guidKey(flow[index].guid))?.rect;
            const current = traces.get(guidKey(child.guid))?.rect;
            if (!previous || !current) return 0;
            return row ? current.x - previous.x - previous.width : current.y - previous.y - previous.height;
        });
        node.stackSpacing = gap && gap !== 'normal' ? px(gap) :
            measuredGaps.length ? Math.max(0, Math.min(...measuredGaps)) : 0;

        // Figma Fill has no CSS margin. Carry cross-axis margins in a transparent
        // stack, so a full-width banner still keeps its side insets when resized.
        if (!grid) for (let index = 0; index < flow.length; index++) {
            const child = flow[index];
            const childElement = elements.get(guidKey(child.guid));
            if (!childElement || childElement === element) continue;
            const childStyle = styleOf(childElement);
            const start = Math.max(0, px(row ? childStyle.marginTop : childStyle.marginLeft));
            const end = Math.max(0, px(row ? childStyle.marginBottom : childStyle.marginRight));
            if (start + end < 0.75) continue;
            const current = traces.get(guidKey(child.guid));
            if (!current || !child.size) continue;
            const width = policy(child, childElement, 'width', element);
            const height = policy(child, childElement, 'height', element);
            const wrapper: NativeNode = {
                type: 'FRAME', phase: 'CREATED', guid: { sessionID: node.guid.sessionID, localID: nextId++ },
                name: `Margins / ${child.name}`, visible: true, opacity: 1, fillPaints: [], frameMaskDisabled: true,
                parentIndex: { guid: node.guid, position: child.parentIndex!.position },
                size: { x: child.size.x + (row ? 0 : start + end), y: child.size.y + (row ? start + end : 0) },
                stackMode: node.stackMode, stackSpacing: 0, stackWrap: 'NO_WRAP', stackPositioning: 'AUTO',
                stackPrimarySizing: (row ? width : height) === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED',
                stackCounterSizing: (row ? height : width) === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED',
                stackPrimaryAlignItems: 'MIN', stackCounterAlignItems: node.stackCounterAlignItems,
                stackHorizontalPadding: row ? 0 : start, stackPaddingRight: row ? 0 : end,
                stackVerticalPadding: row ? start : 0, stackPaddingBottom: row ? end : 0,
            };
            sizingOverrides.set(guidKey(wrapper.guid), { width, height });
            sizingOverrides.set(guidKey(child.guid), { width, height });
            traces.set(guidKey(wrapper.guid), { ...current, guid: wrapper.guid, rect: {
                ...current.rect, x: current.rect.x - (row ? 0 : start), y: current.rect.y - (row ? start : 0),
                width: wrapper.size!.x, height: wrapper.size!.y,
            } });
            child.parentIndex = { guid: wrapper.guid, position: '000000' };
            child.stackPositioning = 'AUTO';
            flow[index] = wrapper;
            childNodes[childNodes.indexOf(child)] = wrapper;
            children.set(guidKey(wrapper.guid), [child]);
            nodes.push(wrapper);
        }
        // Unequal CSS margins cannot be represented by a single Gap. A transparent
        // hugging stack carries the extra spacing as padding, keeping it responsive.
        if (!wrapping && node.stackPrimaryAlignItems !== 'SPACE_BETWEEN') {
            for (let index = 0; index < flow.length - 1; index++) {
                const child = flow[index];
                const current = traces.get(guidKey(child.guid))?.rect;
                const next = traces.get(guidKey(flow[index + 1].guid))?.rect;
                if (!current || !next) continue;
                const extra = (row ? next.x - current.x - current.width : next.y - current.y - current.height) - node.stackSpacing;
                if (extra < 0.75) continue;
                const childElement = elements.get(guidKey(child.guid));
                const width = policy(child, childElement, 'width', element);
                const height = policy(child, childElement, 'height', element);
                const wrapper: NativeNode = {
                    type: 'FRAME', phase: 'CREATED', guid: { sessionID: node.guid.sessionID, localID: nextId++ },
                    name: `Spacing / ${child.name}`, visible: true, opacity: 1, fillPaints: [],
                    parentIndex: { guid: node.guid, position: child.parentIndex!.position },
                    size: { x: (child.size?.x || 0) + (row ? extra : 0), y: (child.size?.y || 0) + (row ? 0 : extra) },
                    stackMode: node.stackMode, stackSpacing: 0, stackPrimarySizing: 'RESIZE_TO_FIT',
                    stackCounterSizing: (row ? height : width) === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED',
                    stackPrimaryAlignItems: 'MIN', stackCounterAlignItems: node.stackCounterAlignItems,
                    stackPaddingRight: row ? extra : 0, stackPaddingBottom: row ? 0 : extra,
                    stackHorizontalPadding: 0, stackVerticalPadding: 0, stackPositioning: 'AUTO',
                };
                sizingOverrides.set(guidKey(wrapper.guid), { width: row ? 'HUG' : width, height: row ? height : 'HUG' });
                sizingOverrides.set(guidKey(child.guid), { width, height });
                child.parentIndex = { guid: wrapper.guid, position: '000000' };
                child.stackPositioning = 'AUTO';
                flow[index] = wrapper;
                childNodes[childNodes.indexOf(child)] = wrapper;
                children.set(guidKey(wrapper.guid), [child]);
                nodes.push(wrapper);
            }
        }
        [...flow, ...childNodes.filter(child => !flow.includes(child))].forEach((child, index) => {
            if (child.parentIndex) child.parentIndex.position = String(index).padStart(6, '0');
        });
        // A background ornament does not become a flow item just because its parent has auto layout.
        for (const child of childNodes) child.stackPositioning = flow.includes(child) ? 'AUTO' : 'ABSOLUTE';
    }
    // Then connect sizing across nesting levels: fill is a CHILD property in Figma.
    for (const parent of nodes) {
        if (parent.type !== 'FRAME' || !parent.stackMode || parent.stackMode === 'NONE') continue;
        const parentElement = elements.get(guidKey(parent.guid));
        const row = parent.stackMode === 'HORIZONTAL';
        for (const child of children.get(guidKey(parent.guid)) || []) {
            if (child.stackPositioning === 'ABSOLUTE') continue;
            const element = elements.get(guidKey(child.guid));
            let main = policy(child, element, row ? 'width' : 'height', parentElement);
            let cross = policy(child, element, row ? 'height' : 'width', parentElement);
            if (element && parentElement && styleOf(parentElement).display.includes('flex') && px(styleOf(element).flexGrow) > 0 && element !== parentElement) {
                const axis = row ? 'width' : 'height';
                const maximum = row ? styleOf(element).maxWidth : styleOf(element).maxHeight;
                const measured = traces.get(guidKey(child.guid))?.rect[axis];
                if (!(/px$/.test(maximum || '') && measured !== undefined && measured >= px(maximum) - 0.5)) main = 'FILL';
            }
            // Wrapped grids need intrinsic card widths; grow would consume the entire row per card.
            if (parent.stackWrap === 'WRAP' && parentElement && styleOf(parentElement).display.includes('grid')) main = main === 'FILL' ? 'FIXED' : main;
            if (parent.stackPrimarySizing === 'RESIZE_TO_FIT' && main === 'FILL') main = 'HUG';
            if (parent.stackCounterSizing === 'RESIZE_TO_FIT' && cross === 'FILL') cross = 'HUG';
            child.stackChildPrimaryGrow = main === 'FILL' ? 1 : 0;
            child.stackChildAlignSelf = cross === 'FILL' ? 'STRETCH' : 'AUTO';
            if (element && element !== parentElement) {
                const selfAlign = styleOf(element).alignSelf;
                if (/center|end/.test(selfAlign)) child.stackChildAlignSelf = align(selfAlign);
            }
            if (child.type === 'FRAME' && child.stackMode && child.stackMode !== 'NONE') {
                const childRow = child.stackMode === 'HORIZONTAL';
                const x = row ? main : cross;
                const y = row ? cross : main;
                child.stackPrimarySizing = (childRow ? x : y) === 'HUG' && child.stackPrimaryAlignItems !== 'SPACE_BETWEEN' ? 'RESIZE_TO_FIT' : 'FIXED';
                child.stackCounterSizing = (childRow ? y : x) === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED';
            }
            if (child.type === 'TEXT') {
                const width = row ? main : cross;
                child.textAutoResize = width === 'HUG' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
            }
        }
    }
}

/** Remove exporter-only shells so the pasted root is the actual resizable design. */
export function compactFigmaRoot(result: ConvertResult, name: string): void {
    if (!result.trace) return;
    const nodes = result.document.nodeChanges as NativeNode[];
    const shell = nodes.find(node => guidKey(node.guid) === guidKey(result.trace!.rootGuid));
    if (!shell?.parentIndex || shell.type !== 'FRAME') return;
    const childOf = (node: NativeNode) => nodes.filter(child => child.parentIndex && guidKey(child.parentIndex.guid) === guidKey(node.guid));
    const shellChildren = childOf(shell);
    if (shellChildren.length !== 1 || shellChildren[0].type !== 'FRAME') return;
    const removed = new Set([guidKey(shell.guid)]);
    let design = shellChildren[0];
    const entry = result.trace.entries.find(trace => guidKey(trace.guid) === guidKey(design.guid));
    const bodyChildren = childOf(design);
    if (entry?.tag === 'body' && bodyChildren.length === 1 && bodyChildren[0].type === 'FRAME' &&
        !design.fillPaints?.length && !design.strokePaints?.length && !design.effects?.length &&
        !design.stackSpacing && !design.stackHorizontalPadding && !design.stackVerticalPadding &&
        !design.stackPaddingRight && !design.stackPaddingBottom &&
        design.stackPrimarySizing === 'RESIZE_TO_FIT' &&
        (!design.stackPrimaryAlignItems || design.stackPrimaryAlignItems === 'MIN') &&
        (!design.stackCounterAlignItems || design.stackCounterAlignItems === 'MIN')) {
        removed.add(guidKey(design.guid));
        design = bodyChildren[0];
    }
    design.parentIndex = shell.parentIndex;
    design.name = `${name} / ${design.name}`;
    design.transform = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    delete design.stackChildAlignSelf;
    delete design.stackChildPrimaryGrow;
    if (design.stackMode === 'HORIZONTAL' || design.stackMode === 'VERTICAL') {
        design.stackPrimarySizing = 'FIXED';
        design.stackCounterSizing = 'FIXED';
    }
    result.document.nodeChanges = nodes.filter(node => !removed.has(guidKey(node.guid)));
    result.trace.rootGuid = design.guid;
}
