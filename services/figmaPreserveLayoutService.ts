import type { ConvertResult } from '@figit/dom-to-figma';

const key = (guid: { sessionID: number; localID: number }) => `${guid.sessionID}:${guid.localID}`;

/** Frames are measured in screen pixels; CSS font metrics still need ancestor scaling. */
function uniformScale(element: Element, view: Window): number {
    let scale = 1;
    for (let current: Element | null = element; current; current = current.parentElement) {
        const transform = view.getComputedStyle(current).transform;
        if (!transform || transform === 'none') continue;
        const values = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
        // Rotation, skew and 3D transforms need a different geometry model.
        if (!values || values.length !== 6 || values.some(value => !Number.isFinite(value)) ||
            Math.abs(values[1]) > 0.0001 || Math.abs(values[2]) > 0.0001 ||
            values[0] <= 0 || Math.abs(values[0] - values[3]) > 0.0001) return 1;
        scale *= values[0];
    }
    return scale;
}

/** Preserve the captured viewport and measured native-layer positions without reflow. */
export function preserveFigmaLayout(root: HTMLElement, result: ConvertResult, width: number, height: number): void {
    const traces = new Map(result.trace?.entries.map(entry => [key(entry.guid), entry]));
    const rootKey = result.trace && key(result.trace.rootGuid);
    for (const node of result.document.nodeChanges) {
        if (node.type === 'FRAME') {
            node.stackMode = 'NONE';
            delete node.stackChildPrimaryGrow;
            delete node.stackChildAlignSelf;
            if (key(node.guid) === rootKey) node.size = { x: width, y: height };
        } else if (node.type === 'TEXT') {
            node.textAutoResize = 'NONE';
        } else continue;

        const trace = traces.get(key(node.guid));
        if (!trace) continue;
        // Avoid the exporter's nearest-edge constraint adjustment for fixed modals.
        const parent = node.parentIndex && traces.get(key(node.parentIndex.guid));
        const matrix = node.transform;
        if (matrix && matrix.m00 === 1 && matrix.m11 === 1 && matrix.m01 === 0 && matrix.m10 === 0) {
            matrix.m02 = trace.rect.x - (parent?.rect.x || 0);
            matrix.m12 = trace.rect.y - (parent?.rect.y || 0);
        }
        if (node.type !== 'TEXT') continue;
        const path = trace.domPath.replace(/::text\[\d+\]$/, '');
        const element = path === ':scope' ? root : root.querySelector(path);
        if (!element) continue;
        const scale = uniformScale(element, root.ownerDocument.defaultView!);
        if (Math.abs(scale - 1) < 0.0001) continue;
        if (node.fontSize) node.fontSize *= scale;
        if (node.lineHeight?.units === 'PIXELS') node.lineHeight.value *= scale;
        if (node.letterSpacing?.units === 'PIXELS') node.letterSpacing.value *= scale;
        const data = node.derivedTextData;
        if (data?.layoutSize) {
            data.layoutSize.x *= scale;
            data.layoutSize.y *= scale;
        }
        data?.baselines?.forEach(baseline => {
            baseline.position.x *= scale;
            baseline.position.y *= scale;
            baseline.width *= scale;
            baseline.lineY *= scale;
            baseline.lineHeight *= scale;
            baseline.lineAscent *= scale;
        });
        data?.glyphs?.forEach(glyph => {
            glyph.position.x *= scale;
            glyph.position.y *= scale;
            glyph.fontSize *= scale;
        });
    }
}
