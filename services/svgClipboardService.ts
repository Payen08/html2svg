/** Copy SVG markup, with a fallback for local HTTP addresses without Clipboard API. */
export async function copySvgToClipboard(source: string): Promise<void> {
    const svg = source.replace(/^\uFEFF/, '')
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!/^<svg(?:\s|>)/.test(svg)) throw new Error('当前画板没有有效的 SVG 内容。');

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(svg);
            return;
        } catch {
            // Some browsers block the modern API on LAN HTTP or deny permission.
        }
    }

    const activeElement = document.activeElement as HTMLElement | null;
    const selection = window.getSelection();
    const ranges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
        : [];
    const textarea = document.createElement('textarea');
    textarea.value = svg;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
    document.body.appendChild(textarea);
    try {
        textarea.select();
        if (!document.execCommand('copy')) throw new Error('浏览器未允许复制，请重试或使用导出 SVG。');
    } finally {
        textarea.remove();
        activeElement?.focus({ preventScroll: true });
        if (selection) {
            selection.removeAllRanges();
            ranges.forEach(range => selection.addRange(range));
        }
    }
}
