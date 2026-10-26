import type { ConvertResult } from '@figit/dom-to-figma';
import { preserveFigmaLayout } from './figmaPreserveLayoutService';

type Tracks = {entries: {id:{sessionID:number;localID:number};position?:string}[]};
type Native = ConvertResult['document']['nodeChanges'][number] & { gridRows?:Tracks; gridColumns?:Tracks; stackPositioning?: string; gridRowAnchor?: {sessionID:number;localID:number}; gridColumnAnchor?: {sessionID:number;localID:number} };
const key = (guid: Native['guid']) => `${guid.sessionID}:${guid.localID}`;
export type FigmaLayoutReport = {
    inspectedFrames: number;
    preserved: { name: string; reason: string; scope: 'container' | 'subtree' }[];
    repaired: number;
};
export type FigmaLayoutBaseline = Map<string, Native>;

/** Keep an independent geometric baseline before any layout pass reparents nodes. */
export function captureFigmaLayoutBaseline(result: ConvertResult): FigmaLayoutBaseline {
    return new Map(structuredClone(result.document.nodeChanges).map(node => [key(node.guid), node]));
}

/** Explicit support boundary: unknown CSS must not be forced into a stack. */
function unsupported(style: CSSStyleDeclaration): { reason: string; scope: 'container' | 'subtree' } | null {
    const transform = style.transform;
    if (transform && transform !== 'none' && !/^matrix\(\s*1\s*,\s*0\s*,\s*0\s*,\s*1\s*,/.test(transform)) {
        return { reason: '缩放、旋转或倾斜变换', scope: 'subtree' };
    }
    if (style.columnCount && style.columnCount !== 'auto' && Number(style.columnCount) > 1 || style.columnWidth && !['auto', '0px'].includes(style.columnWidth)) {
        return { reason: '多栏排版', scope: 'subtree' };
    }
    if (style.writingMode && style.writingMode !== 'horizontal-tb') return { reason: '竖排文字', scope: 'subtree' };
    if (style.direction === 'rtl') return { reason: '从右向左排版', scope: 'container' };
    if (style.display.includes('flex')) {
        if (style.flexDirection.endsWith('reverse') || style.flexWrap === 'wrap-reverse') return { reason: '反向弹性布局', scope: 'container' };
        if (/space-around|space-evenly/.test(style.justifyContent)) return { reason: '环绕式空间分配', scope: 'container' };
        if (style.flexWrap === 'wrap' && /space-between|space-around|space-evenly|stretch/.test(style.alignContent)) return { reason: '多行交叉轴空间分配', scope: 'container' };
    }
    if (style.display.includes('grid')) {
        if (style.gridAutoFlow?.includes('column') || style.gridTemplateAreas && style.gridTemplateAreas !== 'none' || /subgrid|masonry/.test(style.gridTemplateColumns)) {
            return { reason: '命名区域或非逐行网格', scope: 'container' };
        }
    }
    return null;
}

const relationKeys = ['parentIndex', 'stackPositioning', 'stackChildPrimaryGrow', 'stackChildAlignSelf', 'gridRowAnchor', 'gridColumnAnchor', 'gridRowSpan', 'gridColumnSpan', 'gridChildHorizontalAlign', 'gridChildVerticalAlign'] as const;
const gridKeys = ['gridRows', 'gridColumns', 'gridRowsSizing', 'gridColumnsSizing', 'gridAutoTracks', 'gridReflowEnabled', 'gridColumnGap', 'gridRowGap'] as const;

/** Preserve only unsupported relationships; safe sibling/component layouts remain editable Auto Layout. */
export function applyFigmaLayoutSafety(root: HTMLElement, result: ConvertResult, baseline: FigmaLayoutBaseline): FigmaLayoutReport {
    let nodes = result.document.nodeChanges as Native[];
    const report: FigmaLayoutReport = { inspectedFrames: 0, preserved: [], repaired: 0 };
    const traces = new Map(result.trace?.entries.map(entry => [key(entry.guid), entry]));
    const originalChildren = new Map<string, string[]>();
    for (const node of baseline.values()) if (node.parentIndex) {
        const parent = key(node.parentIndex.guid);
        originalChildren.set(parent, [...originalChildren.get(parent) || [], key(node.guid)]);
    }
    const blocked = new Set<string>();
    const descendants = (id: string): string[] => [id, ...(originalChildren.get(id) || []).flatMap(descendants)];
    const sourceBox = (node: Native) => {
        const trace = traces.get(key(node.guid));
        if (trace) {
            // A body containing only fixed overlays has a zero DOM height but
            // still represents the captured viewport, not an empty design.
            const body = trace.domPath === ':scope' && root.tagName === 'BODY';
            node.size = { x: trace.rect.width || (body ? root.ownerDocument.documentElement.clientWidth : 0),
                y: trace.rect.height || (body ? root.ownerDocument.documentElement.clientHeight : 0) };
        }
    };
    const restorePosition = (node: Native, parent: Native) => {
        const original = baseline.get(key(node.guid));
        if (!original) return;
        node.transform = original.transform && { ...original.transform };
        const trace = traces.get(key(node.guid)), owner = traces.get(key(parent.guid));
        if (node.transform && trace && owner && node.transform.m00 === 1 && node.transform.m11 === 1 && !node.transform.m01 && !node.transform.m10) {
            node.transform.m02 = trace.rect.x - owner.rect.x;
            node.transform.m12 = trace.rect.y - owner.rect.y;
        }
        sourceBox(node);
    };
    for (const original of baseline.values()) {
        const id = key(original.guid);
        if (blocked.has(id) || original.type !== 'FRAME') continue;
        const trace = traces.get(id);
        if (!trace || trace.tag === '#text') continue;
        const element = trace.domPath === ':scope' ? root : root.querySelector(trace.domPath);
        if (!element || element.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        report.inspectedFrames++;
        const style = root.ownerDocument.defaultView!.getComputedStyle(element);
        let reason = unsupported(style);
        // Float layout is a relationship between siblings, not a property of their parent.
        if (!reason && Array.from(element.children).some(child => {
            const css = root.ownerDocument.defaultView!.getComputedStyle(child);
            return css.cssFloat && css.cssFloat !== 'none';
        })) reason = { reason: '浮动排版', scope: 'container' };
        if (!reason) continue;
        let node = nodes.find(node => key(node.guid) === id);
        if (!node || node.type !== 'FRAME') continue;
        report.preserved.push({ name: element.id || node.name || element.tagName, ...reason });
        if (reason.scope === 'subtree') {
            const ids = new Set(descendants(id));
            ids.forEach(id => blocked.add(id));
            const relation = Object.fromEntries(relationKeys.filter(field => node![field] !== undefined).map(field => [field, node![field]]));
            // Remove generated wrappers belonging to this subtree before restoring its source hierarchy.
            const currentIds = new Set([id]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const child of nodes) if (child.parentIndex && currentIds.has(key(child.parentIndex.guid)) && !currentIds.has(key(child.guid))) {
                    currentIds.add(key(child.guid)); changed = true;
                }
            }
            const names = new Map(nodes.map(child => [key(child.guid), child.name]));
            nodes = nodes.filter(child => !currentIds.has(key(child.guid)) && !ids.has(key(child.guid)));
            const restored = [...ids].map(id => ({...structuredClone(baseline.get(id)!), name: names.get(id) || baseline.get(id)!.name}));
            const subset = { ...result, document: { ...result.document, nodeChanges: restored } };
            preserveFigmaLayout(root, subset, root.clientWidth, root.clientHeight);
            node = restored.find(child => key(child.guid) === id)!;
            Object.assign(node, relation);
            nodes.push(...restored);
        } else {
            const children = (originalChildren.get(id) || []).map(id => nodes.find(node => key(node.guid) === id)).filter((node): node is Native => !!node);
            const wrappers = new Set<string>();
            for (const child of children) {
                let parent = child.parentIndex && nodes.find(node => key(node.guid) === key(child.parentIndex!.guid));
                while (parent && key(parent.guid) !== id && !baseline.has(key(parent.guid))) {
                    wrappers.add(key(parent.guid));
                    parent = parent.parentIndex && nodes.find(node => key(node.guid) === key(parent!.parentIndex!.guid));
                }
                const source = baseline.get(key(child.guid))!;
                child.parentIndex = { guid: node.guid, position: source.parentIndex!.position };
                restorePosition(child, node);
                for (const field of relationKeys.slice(1)) delete child[field];
                if (child.type === 'FRAME' && child.stackMode && child.stackMode !== 'NONE') {
                    child.stackPrimarySizing = 'FIXED'; child.stackCounterSizing = 'FIXED';
                }
                if (child.type === 'TEXT') child.textAutoResize = 'NONE';
            }
            nodes = nodes.filter(node => !wrappers.has(key(node.guid)));
            node.stackMode = 'NONE';
            for (const field of gridKeys) delete node[field];
            sourceBox(node);
        }
    }
    // An invariant check after ALL layout passes, so a later pass cannot reintroduce collapse.
    for (const node of nodes) if (node.type === 'FRAME' && /^(HORIZONTAL|VERTICAL)$/.test(node.stackMode || '')) {
        const flow = nodes.filter(child => child.parentIndex && key(child.parentIndex.guid) === key(node.guid) && child.stackPositioning !== 'ABSOLUTE');
        if (!flow.length && (node.stackPrimarySizing !== 'FIXED' || node.stackCounterSizing !== 'FIXED')) {
            node.stackPrimarySizing = 'FIXED'; node.stackCounterSizing = 'FIXED'; sourceBox(node); report.repaired++;
        }
    }
    result.document.nodeChanges = nodes;
    return report;
}

/** Never put a structurally broken design on the clipboard. */
export function validateFigmaLayout(result: ConvertResult): void {
    const nodes = result.document.nodeChanges as Native[];
    const byId = new Map(nodes.map(node => [key(node.guid), node]));
    for (const node of nodes) {
        if (node.size && (![node.size.x, node.size.y].every(Number.isFinite) || node.size.x < 0 || node.size.y < 0)) throw new Error(`图层尺寸无效：${node.name}`);
        if (node.transform && !Object.values(node.transform).every(Number.isFinite)) throw new Error(`图层坐标无效：${node.name}`);
        const seen = new Set([key(node.guid)]);
        let parent = node.parentIndex;
        while (parent) {
            const id = key(parent.guid);
            if (seen.has(id)) throw new Error(`图层层级循环：${node.name}`);
            seen.add(id);
            const owner = byId.get(id);
            if (!owner) throw new Error(`图层父容器缺失：${node.name}`);
            parent = owner.parentIndex;
        }
        if (node.type === 'FRAME' && String(node.stackMode) === 'GRID') {
            const rows = new Set(node.gridRows?.entries.map(entry => key(entry.id)));
            const columns = new Set(node.gridColumns?.entries.map(entry => key(entry.id)));
            for (const child of nodes.filter(child => child.parentIndex && key(child.parentIndex.guid) === key(node.guid) && child.stackPositioning !== 'ABSOLUTE')) {
                if (!child.gridRowAnchor || !child.gridColumnAnchor || !rows.has(key(child.gridRowAnchor)) || !columns.has(key(child.gridColumnAnchor))) throw new Error(`网格列或行缺失：${node.name}`);
            }
        }
    }
}
