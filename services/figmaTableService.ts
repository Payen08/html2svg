import type { ConvertResult } from '@figit/dom-to-figma';

type Guid = { sessionID: number; localID: number };
type Native = ConvertResult['document']['nodeChanges'][number];
type TrackSize = { minSizing: { type: string; value?: number }; maxSizing: { type: string; value?: number } };
type Column = { width: number; fixed: boolean; minimum: number; align: 'LEFT' | 'CENTER' | 'RIGHT'; left: number; right: number };
type Cell = { element: HTMLTableCellElement; row: number; column: number; rowSpan: number; columnSpan: number };
export type FigmaTablePlan = { table: HTMLTableElement; cells: Cell[]; columns: Column[]; rows: number };
const key = (guid: Guid) => `${guid.sessionID}:${guid.localID}`;
const px = (value: string) => Number.parseFloat(value) || 0;

function declaredWidth(element: Element): string {
    return (element as HTMLElement & { computedStyleMap?: () => Map<string, unknown> }).computedStyleMap?.().get('width')?.toString()
        || (element as HTMLElement).style?.width || 'auto';
}

/** A table owns its columns; rows must never infer their widths independently. */
export function prepareFigmaTables(doc: Document): FigmaTablePlan[] {
    return Array.from(doc.querySelectorAll('table')).map(table => {
        const cells: Cell[] = [];
        const occupied: boolean[][] = [];
        const rows = Array.from(table.rows).filter(row => doc.defaultView!.getComputedStyle(row).display !== 'none');
        rows.forEach((row, index) => {
            let column = 0;
            for (const element of Array.from(row.cells)) {
                if (doc.defaultView!.getComputedStyle(element).display === 'none') continue;
                while (occupied[index]?.[column]) column++;
                const rowSpan = element.rowSpan === 0 ? rows.length - index : Math.max(1, element.rowSpan);
                const columnSpan = Math.max(1, element.colSpan);
                cells.push({ element, row: index, column, rowSpan, columnSpan });
                for (let r = index; r < Math.min(rows.length, index + rowSpan); r++) {
                    occupied[r] ||= [];
                    for (let c = column; c < column + columnSpan; c++) occupied[r][c] = true;
                }
                column += columnSpan;
            }
        });
        const count = Math.max(0, ...cells.map(cell => cell.column + cell.columnSpan));
        const colElements = Array.from(table.querySelectorAll('col')).filter(col => col.closest('table') === table)
            .flatMap(col => Array.from({ length: col.span || 1 }, () => col));
        const columns: Column[] = Array.from({ length: count }, (_, column) => {
            const matches = cells.filter(cell => cell.column === column && cell.columnSpan === 1);
            const reference = matches.find(cell => cell.element.tagName === 'TH') || matches[0] || cells.find(cell => cell.column <= column && cell.column + cell.columnSpan > column)!;
            const style = doc.defaultView!.getComputedStyle(reference.element);
            const declaration = declaredWidth(colElements[column] || reference.element);
            const width = reference.element.getBoundingClientRect().width / reference.columnSpan;
            return {
                width, fixed: /^\d+(?:\.\d+)?px$/.test(declaration),
                minimum: Math.max(px(style.minWidth), px(style.paddingLeft) + px(style.paddingRight) + 16),
                align: /center/.test(style.textAlign) ? 'CENTER' : /right|end/.test(style.textAlign) ? 'RIGHT' : 'LEFT',
                left: px(style.paddingLeft), right: px(style.paddingRight),
            };
        });
        for (const cell of cells) {
            const column = columns[cell.column];
            // Normalize BEFORE glyph layout too, avoiding stale right/center baseline offsets.
            cell.element.style.setProperty('text-align', column.align.toLowerCase(), 'important');
            cell.element.style.setProperty('padding-left', `${column.left}px`, 'important');
            cell.element.style.setProperty('padding-right', `${columns[cell.column + cell.columnSpan - 1].right}px`, 'important');
        }
        return { table, cells, columns, rows: rows.length };
    }).filter(plan => plan.cells.length);
}

/** Native GRID tracks synchronize both column widths and row heights, including spans. */
export function applyFigmaTableLayout(root: HTMLElement, result: ConvertResult, plans: FigmaTablePlan[]): void {
    const nodes = result.document.nodeChanges;
    const byId = new Map(nodes.map(node => [key(node.guid), node]));
    const byElement = new Map<Element, Native>();
    for (const trace of result.trace?.entries || []) {
        if (trace.tag === '#text') continue;
        const path = trace.domPath.replace(/::text\[\d+\]$/, '');
        const element = path === ':scope' ? root : root.querySelector(path);
        const node = byId.get(key(trace.guid));
        if (element && node) byElement.set(element, node);
    }
    let nextId = Math.max(...nodes.map(node => node.guid.localID)) + 1;
    const removed = new Set<string>();
    for (const plan of plans) {
        const table = byElement.get(plan.table);
        if (table?.type !== 'FRAME') continue;
        const guid = () => ({ sessionID: table.guid.sessionID, localID: nextId++ });
        const rowIds = Array.from({ length: plan.rows }, guid);
        const columnIds = plan.columns.map(guid);
        const positions = (ids: Guid[]) => ({ entries: ids.map((id, index) => ({ id, position: String(index).padStart(6, '0') })) });
        const sizes = (ids: Guid[], tracks: TrackSize[]) => ({ entries: ids.map((id, index) => ({ id, trackSize: tracks[index] })) });
        const tracks = plan.columns.map(column => column.fixed
            ? { minSizing: { type: 'FIXED', value: column.width }, maxSizing: { type: 'FIXED', value: column.width } }
            : { minSizing: { type: 'FIXED', value: column.minimum }, maxSizing: { type: 'FLEX', value: column.width } });
        Object.assign(table, {
            stackMode: 'GRID', stackPrimarySizing: 'FIXED', stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
            stackSpacing: 0, stackWrap: 'NO_WRAP', stackHorizontalPadding: 0, stackVerticalPadding: 0,
            stackPaddingRight: 0, stackPaddingBottom: 0, gridRowGap: 0, gridColumnGap: 0,
            gridRows: positions(rowIds), gridColumns: positions(columnIds),
            gridRowsSizing: sizes(rowIds, rowIds.map(() => ({ minSizing: { type: 'HUG', value: 1 }, maxSizing: { type: 'HUG', value: 1 } }))),
            gridColumnsSizing: sizes(columnIds, tracks), gridAutoTracks: 'ROWS', gridReflowEnabled: true,
            frameMaskDisabled: true,
            minSize: { value: { x: plan.columns.reduce((sum, col) => sum + (col.fixed ? col.width : col.minimum), 0), y: 0 } },
        });
        const cellRoots = new Set<string>();
        // Determine structural wrappers to discard while the original tree is intact.
        const originals = plan.cells.map(cell => byElement.get(cell.element)).filter((node): node is Native => !!node);
        const originalCells = new Set(originals.map(node => key(node.guid)));
        for (const node of nodes) {
            if (node === table) continue;
            let current: Native | undefined = node;
            let belongsToCell = false;
            const seen = new Set<string>();
            while (current && !seen.has(key(current.guid))) {
                seen.add(key(current.guid));
                if (originalCells.has(key(current.guid))) belongsToCell = true;
                if (current === table) { if (!belongsToCell) removed.add(key(node.guid)); break; }
                current = current.parentIndex && byId.get(key(current.parentIndex.guid));
            }
        }
        plan.cells.forEach((cell, index) => {
            const original = byElement.get(cell.element);
            if (!original) return;
            const style = root.ownerDocument.defaultView!.getComputedStyle(cell.element);
            const column = plan.columns[cell.column];
            let frame: Native = original;
            if (original.type !== 'FRAME') {
                const rect = cell.element.getBoundingClientRect();
                frame = { type: 'FRAME', phase: 'CREATED', guid: guid(), name: 'Table Cell', visible: true, opacity: 1,
                    size: { x: rect.width, y: rect.height }, fillPaints: [] };
                original.parentIndex = { guid: frame.guid, position: '000000' };
                nodes.push(frame); byId.set(key(frame.guid), frame);
            }
            if (frame.type !== 'FRAME') return;
            const row = cell.element.parentElement && byElement.get(cell.element.parentElement);
            if (!frame.fillPaints?.length && row?.type === 'FRAME' && row.fillPaints?.length) frame.fillPaints = row.fillPaints;
            frame.name = `${cell.element.tagName === 'TH' ? 'Header' : `Row ${cell.row}`} / Column ${cell.column + 1}`;
            frame.parentIndex = { guid: table.guid, position: String(index).padStart(6, '0') };
            cellRoots.add(key(frame.guid));
            Object.assign(frame, {
                stackMode: 'VERTICAL', stackPrimarySizing: 'FIXED', stackCounterSizing: 'FIXED',
                stackPrimaryAlignItems: 'CENTER', stackCounterAlignItems: column.align === 'LEFT' ? 'MIN' : column.align === 'RIGHT' ? 'MAX' : 'CENTER',
                stackSpacing: 0, stackPositioning: 'AUTO', stackChildPrimaryGrow: 1, stackChildAlignSelf: 'STRETCH',
                stackHorizontalPadding: column.left, stackPaddingRight: plan.columns[cell.column + cell.columnSpan - 1].right,
                stackVerticalPadding: px(style.paddingTop), stackPaddingBottom: px(style.paddingBottom),
                gridRowAnchor: rowIds[cell.row], gridColumnAnchor: columnIds[cell.column],
                gridRowSpan: cell.rowSpan, gridColumnSpan: cell.columnSpan,
                gridChildHorizontalAlign: 'AUTO', gridChildVerticalAlign: 'AUTO', frameMaskDisabled: true,
            });
            // Only immediate cell text stretches; nested badges/buttons keep their own layout.
            for (const child of nodes.filter(node => node.parentIndex && key(node.parentIndex.guid) === key(frame.guid))) {
                if (child.type !== 'TEXT') continue;
                child.textAlignHorizontal = column.align;
                child.textAlignVertical = 'CENTER';
                child.textAutoResize = 'HEIGHT';
                Object.assign(child, { stackChildAlignSelf: 'STRETCH', stackChildPrimaryGrow: 0, stackPositioning: 'AUTO' });
            }
        });
        for (const id of cellRoots) removed.delete(id);
    }
    result.document.nodeChanges = nodes.filter(node => !removed.has(key(node.guid)));
}
