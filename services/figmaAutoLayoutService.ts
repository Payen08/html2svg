import type { ConvertResult } from '@figit/dom-to-figma';

type NativeNode = ConvertResult['document']['nodeChanges'][number] & {
    stackChildPrimaryGrow?: number; stackChildAlignSelf?: string; stackPositioning?: string;
};
type Sizing = 'HUG' | 'FILL' | 'FIXED';
const guidKey = (guid: { sessionID: number; localID: number }) => `${guid.sessionID}:${guid.localID}`;
const px = (value: string) => Number.parseFloat(value) || 0;
const align = (value: string) => /center/.test(value) ? 'CENTER' : /end|right/.test(value) ? 'MAX' : 'MIN';

/** Typed OM preserves auto/percent sizes, unlike getComputedStyle's resolved pixels. */
function declaredSize(element: Element, axis: 'width' | 'height'): string {
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
            if (/^(block|table-cell)$/.test(style.display) ||
                (style.display.includes('flex') && style.flexDirection.startsWith('column') && /stretch|normal/.test(style.alignItems))) return 'FILL';
            return 'HUG';
        }
        const size = declaredSize(element, axis);
        if (/^100(?:\.0+)?%$/.test(size)) return 'FILL';
        if (!/^(auto|min-content|max-content|fit-content)(\(|$)/.test(size)) return 'FIXED';
        if (node.type === 'TEXT' && axis === 'height') return 'HUG';
        const parentStyle = parent && styleOf(parent);
        if (parentStyle?.display.includes('flex')) {
            const mainAxis = parentStyle.flexDirection.startsWith('row') ? 'width' : 'height';
            if (axis === mainAxis) return px(style.flexGrow) > 0 ? 'FILL' : 'HUG';
            const selfAlign = style.alignSelf === 'auto' ? parentStyle.alignItems : style.alignSelf;
            return /stretch|normal/.test(selfAlign) ? 'FILL' : 'HUG';
        }
        if (axis === 'height') return 'HUG';
        if (element.tagName === 'BUTTON' || /inline/.test(style.display)) return 'HUG';
        return 'FILL';
    };

    const rootNode = result.trace && nodes.find(node => guidKey(node.guid) === guidKey(result.trace!.rootGuid));
    if (rootNode?.type === 'FRAME') {
        Object.assign(rootNode, { stackMode: 'VERTICAL', stackSpacing: 0, stackPrimarySizing: 'RESIZE_TO_FIT', stackCounterSizing: 'FIXED' });
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
            return !childElement || childElement === element || !/^(absolute|fixed)$/.test(styleOf(childElement).position);
        });
        const grid = style.display.includes('grid');
        const row = style.display.includes('flex') ? style.flexDirection.startsWith('row') :
            grid ? style.gridTemplateColumns.trim().split(/\s+/).length > 1 :
                /^(BUTTON|TR)$/.test(element.tagName) || /inline/.test(style.display);
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
                    if (value < 0) node[padding] = Math.max(0, px(style[padding === 'stackHorizontalPadding' ? 'paddingLeft' : padding === 'stackPaddingRight' ? 'paddingRight' : padding === 'stackVerticalPadding' ? 'paddingTop' : 'paddingBottom']) + value);
                }
            }
        }
        // Reserve the visible scrollbar gutter instead of stretching content into it.
        if (/auto|scroll/.test(style.overflowY) && 'offsetWidth' in element) {
            const gutter = (element as HTMLElement).offsetWidth - element.clientWidth - px(style.borderLeftWidth) - px(style.borderRightWidth);
            if (gutter > 0) node.stackPaddingRight += gutter;
        }
        node.stackPrimaryAlignItems = style.justifyContent === 'space-between' ? 'SPACE_BETWEEN' : align(style.justifyContent);
        node.stackCounterAlignItems = element.tagName === 'BUTTON' ? 'CENTER' : align(style.alignItems);
        const gap = row ? style.columnGap : style.rowGap;
        const measuredGaps = flow.slice(1).map((child, index) => {
            const previous = traces.get(guidKey(flow[index].guid))?.rect;
            const current = traces.get(guidKey(child.guid))?.rect;
            if (!previous || !current) return 0;
            return row ? current.x - previous.x - previous.width : current.y - previous.y - previous.height;
        });
        node.stackSpacing = gap && gap !== 'normal' ? px(gap) :
            measuredGaps.length ? Math.max(0, Math.min(...measuredGaps)) : 0;
        // Editable button groups wrap instead of overflowing when labels grow or the parent narrows.
        const buttonGroup = flow.length > 1 && flow.every(child => elements.get(guidKey(child.guid))?.tagName === 'BUTTON');
        const wrapping = row && (grid || style.flexWrap === 'wrap' || buttonGroup);
        node.stackWrap = wrapping ? 'WRAP' : 'NO_WRAP';
        node.stackCounterSpacing = wrapping ? px(style.rowGap) : 0;
        const width = policy(node, element, 'width', parentElement);
        const height = policy(node, element, 'height', parentElement);
        node.stackPrimarySizing = (row ? width : height) === 'HUG' && node.stackPrimaryAlignItems !== 'SPACE_BETWEEN' ? 'RESIZE_TO_FIT' : 'FIXED';
        node.stackCounterSizing = (row ? height : width) === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED';
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
            if (element && parentElement && styleOf(parentElement).display.includes('flex') && px(styleOf(element).flexGrow) > 0 && element !== parentElement) main = 'FILL';
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
    if (design.stackMode === 'HORIZONTAL') design.stackPrimarySizing = 'FIXED';
    else if (design.stackMode === 'VERTICAL') design.stackCounterSizing = 'FIXED';
    result.document.nodeChanges = nodes.filter(node => !removed.has(guidKey(node.guid)));
    result.trace.rootGuid = design.guid;
}
