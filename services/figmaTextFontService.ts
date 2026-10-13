export const FIGMA_TEXT_FONT = 'PingFang SC';

/** Match the six real PingFang SC faces instead of synthesizing missing Bold/Italic. */
export function pingFangWeight(weight: number): number {
    return Math.max(100, Math.min(600, Math.round((weight || 400) / 100) * 100));
}

export function applyFigmaTextFont(doc: Document): void {
    const view = doc.defaultView;
    if (!view) return;
    [doc.body, ...Array.from(doc.body.querySelectorAll<HTMLElement>('*'))].forEach(element => {
        const style = view.getComputedStyle(element);
        // Font-based icons have their own glyph encoding; do not turn them into text.
        if (/icon|material|awesome|symbol/i.test(style.fontFamily)) return;
        element.style.setProperty('font-family', `"${FIGMA_TEXT_FONT}", sans-serif`, 'important');
        element.style.setProperty('font-weight', String(pingFangWeight(Number(style.fontWeight))), 'important');
        element.style.setProperty('font-style', 'normal', 'important');
        // Unitless leading follows inherited font sizes and gives CJK glyphs room.
        if (style.lineHeight === 'normal') element.style.setProperty('line-height', '1.5', 'important');
    });
}

type TextFontNode = { type?: string; fontName?: { family: string; style: string; postscript?: string } };
export function normalizePingFangNames(nodes: TextFontNode[]): void {
    nodes.forEach(node => {
        const font = node.fontName;
        if (font?.family !== FIGMA_TEXT_FONT) return;
        // Figma/Apple calls this face "Semibold", whereas generic weight maps say "SemiBold".
        if (font.postscript?.startsWith('PingFangSC-')) font.style = font.postscript.slice('PingFangSC-'.length);
    });
}
