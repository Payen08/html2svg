/** Follow full-page iframe wrappers to the document containing the visible UI. */
export function selectCaptureDocument(source: Document): Document {
    const visited = new Set<Document>();
    let current = source;
    while (!visited.has(current)) {
        visited.add(current);
        const view = current.defaultView;
        if (!view) break;
        const frame = Array.from(current.querySelectorAll('iframe')).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = view.getComputedStyle(candidate);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && style.opacity !== '0'
                && Math.abs(rect.left) <= 8 && Math.abs(rect.top) <= 8
                && rect.width >= view.innerWidth * 0.9
                && rect.height >= view.innerHeight * 0.9;
        });
        if (!frame) break;
        let child: Document | null;
        try {
            child = frame.contentDocument;
        } catch {
            throw new Error('无法读取内嵌页面，请重新启动代理预览后再捕获。');
        }
        if (!child?.body || child.readyState === 'loading') {
            throw new Error('内嵌页面尚未加载完成或无法读取，请等待页面显示后再捕获。');
        }
        current = child;
    }
    return current;
}

/** Freeze a live document without scripts, preserving fields and resource URLs. */
export function serializeCaptureDocument(source: Document): { html: string; url: string } {
    const clone = source.documentElement.cloneNode(true) as HTMLElement;
    const fields = source.querySelectorAll('input, textarea, select');
    const clonedFields = clone.querySelectorAll('input, textarea, select');
    fields.forEach((field, index) => {
        const copy = clonedFields[index];
        if (!copy) return;
        if (field.tagName === 'TEXTAREA') {
            copy.textContent = (field as HTMLTextAreaElement).value;
        } else if (field.tagName === 'SELECT') {
            Array.from((field as HTMLSelectElement).options).forEach((option, optionIndex) => {
                const clonedOption = (copy as HTMLSelectElement).options[optionIndex];
                if (clonedOption) clonedOption.toggleAttribute('selected', option.selected);
            });
        } else if (['checkbox', 'radio'].includes((field as HTMLInputElement).type)) {
            copy.toggleAttribute('checked', (field as HTMLInputElement).checked);
        } else {
            copy.setAttribute('value', (field as HTMLInputElement).value);
        }
    });
    clone.querySelectorAll('script, noscript, base').forEach(node => node.remove());
    clone.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        });
        ['src', 'href', 'action', 'poster'].forEach(attr => {
            const raw = node.getAttribute(attr);
            if (!raw || /^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(raw)) return;
            try { node.setAttribute(attr, new URL(raw, source.baseURI).href); } catch {}
        });
    });
    return { html: '<!DOCTYPE html>\n' + clone.outerHTML, url: source.URL };
}
