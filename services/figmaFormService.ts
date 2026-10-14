/** Materialize browser-painted controls into editable DOM text/vector layers. */
export function prepareFigmaFormControls(doc: Document): void {
    const view = doc.defaultView!;
    const copyBox = (source: HTMLElement, target: HTMLElement) => {
        for (const attr of Array.from(source.attributes)) target.setAttribute(attr.name, attr.value);
        const style = view.getComputedStyle(source);
        for (let i = 0; i < style.length; i++) {
            const property = style[i];
            target.style.setProperty(property, style.getPropertyValue(property), 'important');
        }
        const typed = (source as HTMLElement & { computedStyleMap?: () => Map<string, unknown> }).computedStyleMap?.();
        for (const axis of ['width', 'height']) {
            const sizing = source.getAttribute(`data-html2svg-sizing-${axis}`) || typed?.get(axis)?.toString();
            if (sizing) target.setAttribute(`data-html2svg-sizing-${axis}`, sizing);
        }
        return style;
    };
    const svg = (markup: string) => {
        const element = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        element.setAttribute('viewBox', '0 0 16 16');
        element.setAttribute('width', '16'); element.setAttribute('height', '16');
        element.style.cssText = 'display:block;flex:none;width:16px;height:16px;overflow:visible';
        element.innerHTML = markup;
        return element;
    };
    doc.querySelectorAll<HTMLSelectElement>('select:not([multiple])').forEach(select => {
        if (select.size > 1 || view.getComputedStyle(select).display === 'none') return;
        const replacement = doc.createElement('div');
        const style = copyBox(select, replacement);
        replacement.setAttribute('data-figma-name', select.getAttribute('aria-label') || 'Select / ' + (select.selectedOptions[0]?.textContent || ''));
        replacement.style.setProperty('display', style.display.startsWith('inline') ? 'inline-flex' : 'flex', 'important');
        replacement.style.setProperty('align-items', 'center', 'important');
        replacement.style.setProperty('justify-content', 'space-between', 'important');
        replacement.style.setProperty('gap', '8px', 'important');
        replacement.style.setProperty('appearance', 'none', 'important');
        const text = doc.createElement('span');
        text.textContent = select.selectedOptions[0]?.textContent || '';
        text.style.cssText = 'display:block;flex:1;min-width:0;white-space:normal';
        const arrow = svg('<path d="M4 6L8 10L12 6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>');
        replacement.append(text);
        if (style.appearance !== 'none') replacement.append(arrow);
        select.replaceWith(replacement);
    });
    doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]').forEach(input => {
        const style = view.getComputedStyle(input);
        // Custom controls paint themselves; only replace native browser widgets.
        if (style.display === 'none' || style.appearance === 'none') return;
        const rect = input.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const replacement = doc.createElement('span');
        copyBox(input, replacement);
        replacement.setAttribute('data-figma-name', `${input.type === 'radio' ? 'Radio' : 'Checkbox'} / ${input.checked ? 'checked' : 'unchecked'}`);
        replacement.setAttribute('data-html2svg-sizing-width', `${rect.width}px`);
        replacement.setAttribute('data-html2svg-sizing-height', `${rect.height}px`);
        replacement.style.setProperty('width', `${rect.width}px`, 'important');
        replacement.style.setProperty('height', `${rect.height}px`, 'important');
        replacement.style.setProperty('appearance', 'none', 'important');
        const accent = style.accentColor === 'auto' ? '#0075ff' : style.accentColor;
        const shape = input.type === 'radio'
            ? `<circle cx="8" cy="8" r="6.5" fill="white" stroke="${input.checked ? accent : '#999'}"/>${input.checked ? `<circle cx="8" cy="8" r="3.5" fill="${accent}"/>` : ''}`
            : `<rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="${input.checked ? accent : 'white'}" stroke="${input.checked ? accent : '#999'}"/>${(input.indeterminate || input.hasAttribute('data-html2svg-indeterminate')) ? '<path d="M4 8H12" stroke="white" stroke-width="2"/>' : input.checked ? '<path d="M4 8L7 11L12 5" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' : ''}`;
        const icon = svg(shape);
        icon.style.width = '100%'; icon.style.height = '100%';
        replacement.append(icon); input.replaceWith(replacement);
    });
}
