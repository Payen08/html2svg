import type { ConvertResult } from '@figit/dom-to-figma';

/** Keep CSS centering explicit in editable Figma text and stack properties. */
export function applyFigmaAlignment(root: HTMLElement, result: ConvertResult): void {
    const key = (guid: { sessionID: number; localID: number }) => `${guid.sessionID}:${guid.localID}`;
    const traces = new Map(result.trace?.entries.map(entry => [key(entry.guid), entry]));
    const nodes = new Map(result.document.nodeChanges.map(node => [key(node.guid), node]));
    for (const node of result.document.nodeChanges) {
        const trace = traces.get(key(node.guid));
        if (!trace) continue;
        const path = trace.domPath.replace(/::text\[\d+\]$/, '');
        const element = path === ':scope' ? root : root.querySelector(path);
        if (!element) continue;
        const style = root.ownerDocument.defaultView!.getComputedStyle(element);
        if (node.type === 'FRAME' && node.stackMode && node.stackMode !== 'NONE' && /flex/.test(style.display)) {
            if (style.alignItems === 'center') node.stackCounterAlignItems = 'CENTER';
            if (style.justifyContent === 'center') node.stackPrimaryAlignItems = 'CENTER';
        }
        if (node.type !== 'TEXT') continue;
        // CSS text-align concerns horizontal centering; flex alignment concerns the text box.
        if (style.textAlign === 'center') node.textAlignHorizontal = 'CENTER';
        const owner = element.closest('button, [role="button"], label') || element;
        const ownerStyle = root.ownerDocument.defaultView!.getComputedStyle(owner);
        const parent = node.parentIndex && nodes.get(key(node.parentIndex.guid));
        const centeredStack = parent?.type === 'FRAME' &&
            (parent.stackMode === 'HORIZONTAL' ? parent.stackCounterAlignItems === 'CENTER' :
                parent.stackMode === 'VERTICAL' && parent.stackPrimaryAlignItems === 'CENTER');
        const centered = owner.tagName === 'BUTTON' ||
            centeredStack ||
            (/flex/.test(ownerStyle.display) &&
                (ownerStyle.flexDirection.startsWith('row') ? ownerStyle.alignItems === 'center' : ownerStyle.justifyContent === 'center'));
        if (centered && !node.characters.includes('\n')) node.textAlignVertical = 'CENTER';
    }
}
