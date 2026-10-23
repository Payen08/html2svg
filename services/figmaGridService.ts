import type { ConvertResult } from '@figit/dom-to-figma';

const key = (guid: { sessionID: number; localID: number }) => `${guid.sessionID}:${guid.localID}`;
const align = (value: string) => /center/.test(value) ? 'CENTER' : /end|right/.test(value) ? 'MAX' : 'MIN';
function declaration(element: Element, property: string): string {
    const captured = element.getAttribute?.(`data-html2svg-sizing-${property}`);
    if (captured) return captured;
    return (element as HTMLElement & { computedStyleMap?: () => Map<string, unknown> }).computedStyleMap?.().get(property)?.toString()
        || (element as HTMLElement).style?.getPropertyValue(property) || 'auto';
}
const automatic = (value: string) => /^(auto|normal|min-content|max-content|fit-content)(\(|$)/.test(value);

/** Preserve grid tracks and item alignment; explicit icon sizes never become Fill. */
export function applyFigmaGridLayout(root: HTMLElement, result: ConvertResult): void {
    const nodes = result.document.nodeChanges;
    const traces = new Map(result.trace?.entries.map(trace => [key(trace.guid), trace]));
    let nextId = Math.max(...nodes.map(node => node.guid.localID)) + 1;
    const elementOf = (guid: Parameters<typeof key>[0]) => {
        const trace = traces.get(key(guid));
        if (!trace) return null;
        return trace.domPath === ':scope' ? root : root.querySelector(trace.domPath.replace(/::text\[\d+\]$/, ''));
    };
    const styleOf = (element: Element) => root.ownerDocument.defaultView!.getComputedStyle(element);
    for (const trace of result.trace?.entries || []) {
        if (trace.tag === '#text') continue;
        const element = elementOf(trace.guid);
        if (!element || element.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        const style = styleOf(element);
        if (!style.display.includes('grid')) continue;
        const node = nodes.find(candidate => key(candidate.guid) === key(trace.guid));
        if (node?.type !== 'FRAME') continue;
        const columns = (style.gridTemplateColumns.match(/[\d.]+px/g) || []).map(parseFloat);
        if (!columns.length) continue;
        const children = nodes.filter(candidate => candidate.parentIndex && key(candidate.parentIndex.guid) === key(node.guid)
            && (candidate as typeof candidate & { stackPositioning?: string }).stackPositioning !== 'ABSOLUTE');
        if (!children.length) continue;

        const itemSizing = (child: typeof children[number]) => {
            const childElement = elementOf(child.guid);
            const childStyle = childElement && styleOf(childElement);
            const horizontal = childStyle?.justifySelf && childStyle.justifySelf !== 'auto' ? childStyle.justifySelf : style.justifyItems || 'normal';
            const vertical = childStyle?.alignSelf && childStyle.alignSelf !== 'auto' ? childStyle.alignSelf : style.alignItems || 'normal';
            return {
                horizontal, vertical,
                fillWidth: (!childElement || automatic(declaration(childElement, 'width'))) && /stretch|normal/.test(horizontal),
                fillHeight: (!childElement || automatic(declaration(childElement, 'height'))) && /stretch|normal/.test(vertical),
            };
        };

        // place-items:center is commonly used for one fixed-size SVG in a button.
        // A centered native stack represents it without a circular Hug/Fill grid.
        if (columns.length === 1 && children.length === 1) {
            const child = children[0];
            const sizing = itemSizing(child);
            Object.assign(node, {
                stackMode: 'HORIZONTAL', stackWrap: 'NO_WRAP', stackSpacing: 0,
                stackPrimarySizing: automatic(declaration(element, 'width')) ? 'RESIZE_TO_FIT' : 'FIXED',
                stackCounterSizing: automatic(declaration(element, 'height')) ? 'RESIZE_TO_FIT' : 'FIXED',
                stackPrimaryAlignItems: align(sizing.horizontal), stackCounterAlignItems: align(sizing.vertical),
            });
            Object.assign(child, { stackChildPrimaryGrow: sizing.fillWidth ? 1 : 0, stackChildAlignSelf: sizing.fillHeight ? 'STRETCH' : 'AUTO' });
            continue;
        }

        const flexible = /fr|auto|min-content|max-content/.test(declaration(element, 'grid-template-columns'));
        const fixedHeight = !automatic(declaration(element, 'height'));
        const guid = () => ({ sessionID: node.guid.sessionID, localID: nextId++ });
        const columnIds = columns.map(guid);
        // CSS Grid items occupy tracks, not just their ordinal child index.
        // Tailwind's col-span-7 / col-span-5 must remain 7 / 5 native tracks.
        const axis = (start: string = 'auto', end: string = 'auto', count: number) => {
            const line = (value: string) => /^-?\d+$/.test(value) ? (Number(value) > 0 ? Number(value) - 1 : count + Number(value) + 1) : undefined;
            let first = line(start), last = line(end);
            let span = Math.max(1, Number((start.match(/\bspan\s+(\d+)/) || end.match(/\bspan\s+(\d+)/))?.[1]) || 1);
            if (first !== undefined && last !== undefined) span = Math.max(1, last - first);
            else if (first === undefined && last !== undefined) first = Math.max(0, last - span);
            return { start: first, span };
        };
        const occupied = new Set<string>();
        let cursor = 0;
        const dense = style.gridAutoFlow?.includes('dense');
        const placements = children.map(child => {
            const owner = elementOf(child.guid);
            const css = owner ? styleOf(owner) : style;
            const col = axis(css.gridColumnStart, css.gridColumnEnd, columns.length);
            const row = axis(css.gridRowStart, css.gridRowEnd, Math.max(children.length, 1));
            col.span = Math.min(col.span, columns.length);
            if (col.start !== undefined) col.start = Math.min(Math.max(0, col.start), columns.length - col.span);
            const free = (r: number, c: number) => {
                if (c + col.span > columns.length) return false;
                for (let y = r; y < r + row.span; y++) for (let x = c; x < c + col.span; x++) if (occupied.has(`${y}:${x}`)) return false;
                return true;
            };
            let r = row.start ?? Math.floor((dense ? 0 : cursor) / columns.length);
            let c = col.start ?? (row.start !== undefined ? 0 : (dense ? 0 : cursor) % columns.length);
            if (col.start !== undefined && c < cursor % columns.length && row.start === undefined && !dense) r++;
            while (!(row.start !== undefined && col.start !== undefined) && !free(r, c)) {
                if (col.start !== undefined) r++;
                else { c++; if (c >= columns.length) { c = 0; r++; } }
            }
            for (let y = r; y < r + row.span; y++) for (let x = c; x < c + col.span; x++) occupied.add(`${y}:${x}`);
            cursor = r * columns.length + c + col.span;
            return { row: r, column: c, rowSpan: row.span, columnSpan: col.span };
        });
        const rowIds = Array.from({ length: Math.max(...placements.map(p => p.row + p.rowSpan)) }, guid);
        const flexRows = fixedHeight && /fr/.test(declaration(element, 'grid-template-rows'));
        const positions = (ids: typeof columnIds) => ({ entries: ids.map((id, index) => ({ id, position: String(index).padStart(6, '0') })) });
        Object.assign(node, {
            stackMode: 'GRID', stackWrap: 'NO_WRAP', stackPrimarySizing: 'FIXED',
            stackCounterSizing: fixedHeight ? 'FIXED' : 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
            gridColumns: positions(columnIds), gridRows: positions(rowIds), gridAutoTracks: 'ROWS', gridReflowEnabled: true,
            gridColumnGap: parseFloat(style.columnGap) || 0, gridRowGap: parseFloat(style.rowGap) || 0,
            gridColumnsSizing: { entries: columnIds.map((id, index) => ({ id, trackSize: {
                minSizing: { type: 'FIXED', value: flexible ? 0 : columns[index] },
                maxSizing: { type: flexible ? 'FLEX' : 'FIXED', value: columns[index] },
            } })) },
            gridRowsSizing: { entries: rowIds.map(id => ({ id, trackSize: { minSizing: { type: flexRows ? 'FIXED' : 'HUG', value: flexRows ? 0 : 1 }, maxSizing: { type: flexRows ? 'FLEX' : 'HUG', value: 1 } } })) },
        });
        children.forEach((child, index) => {
            const sizing = itemSizing(child);
            const placement = placements[index];
            Object.assign(child, {
                gridRowAnchor: rowIds[placement.row], gridColumnAnchor: columnIds[placement.column],
                gridRowSpan: placement.rowSpan, gridColumnSpan: placement.columnSpan, gridChildHorizontalAlign: align(sizing.horizontal), gridChildVerticalAlign: align(sizing.vertical),
                stackChildPrimaryGrow: sizing.fillWidth ? 1 : 0, stackChildAlignSelf: sizing.fillHeight ? 'STRETCH' : 'AUTO',
            });
            if (child.type === 'FRAME' && child.stackMode === 'VERTICAL') {
                if (sizing.fillWidth) child.stackCounterSizing = 'FIXED';
                if (sizing.fillHeight) child.stackPrimarySizing = 'FIXED';
            }
        });
    }
}
