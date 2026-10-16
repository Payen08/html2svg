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
    // new URL('/logo.png', proxyBase) drops the proxy prefix. Keep resources
    // bound to the live captured page, including absolute URLs made by JS.
    const resolveResource = (raw: string): string => {
        const resolved = new URL(raw, source.baseURI);
        const page = new URL(source.URL);
        const match = page.pathname.match(/^\/(?:proxy-url\/[^/]+|proxy\/\d+)(?=\/|$)/);
        if (!match) return resolved.href;
        const prefix = match[0];
        const targetOrigin = prefix.startsWith('/proxy-url/')
            ? new URL(decodeURIComponent(prefix.slice('/proxy-url/'.length))).origin
            : `http://127.0.0.1:${prefix.slice('/proxy/'.length)}`;
        if (resolved.origin !== page.origin && resolved.origin !== targetOrigin) return resolved.href;
        if (resolved.origin === page.origin && /^\/(?:proxy|proxy-url|__html2svg_internal__)(?:\/|$)/.test(resolved.pathname)) return resolved.href;
        return page.origin + prefix + resolved.pathname + resolved.search + resolved.hash;
    };
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
            copy.toggleAttribute('data-html2svg-indeterminate', (field as HTMLInputElement).indeterminate);
        } else {
            const input = field as HTMLInputElement;
            copy.setAttribute('value', input.type === 'password' ? '•'.repeat(input.value.length) : input.value);
        }
    });
    // Modal/popover membership lives in the browser's top layer, not in HTML.
    // Freeze it into ordinary visible layers before scripts are removed.
    const view = source.defaultView;
    if (view) {
        const originals = Array.from(source.querySelectorAll<HTMLElement>('dialog[open], [popover], [role="dialog"], [aria-modal="true"]'));
        const copies = Array.from(clone.querySelectorAll<HTMLElement>('dialog[open], [popover], [role="dialog"], [aria-modal="true"]'));
        let layer = 0;
        originals.forEach((element, index) => {
            const copy = copies[index];
            if (!copy) return;
            const style = view.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') return;
            const modal = element.matches(':modal');
            const popover = element.hasAttribute('popover') && element.matches(':popover-open');
            if (!modal && !popover && style.position !== 'fixed') return;
            // Keep :modal / :popover-open rules, including descendant styles.
            const liveNodes = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];
            const cloneNodes = [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))];
            liveNodes.forEach((node, offset) => {
                const computed = view.getComputedStyle(node);
                const target = cloneNodes[offset];
                if (!target?.style) return;
                for (let property = 0; property < computed.length; property++) {
                    const name = computed[property];
                    target.style.setProperty(name, computed.getPropertyValue(name), 'important');
                }
                // Keep the authored sizing policy separately from the frozen pixel box.
                // Auto Layout must still distinguish auto/percent from fixed sizes.
                const typed = (node as HTMLElement & { computedStyleMap?: () => Map<string, unknown> }).computedStyleMap?.();
                for (const axis of ['width', 'height']) {
                    const sizing = typed?.get(axis)?.toString();
                    if (sizing) target.setAttribute(`data-html2svg-sizing-${axis}`, sizing);
                }
                target.style.setProperty('animation', 'none', 'important');
                target.style.setProperty('transition', 'none', 'important');
            });
            if (popover) copy.removeAttribute('popover');
            // A transformed ancestor establishes a fixed-position containing block.
            // Only viewport-fixed overlays can use screen coordinates directly.
            let transformedAncestor = false;
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const parentStyle = view.getComputedStyle(parent);
                if (parentStyle.transform !== 'none' || parentStyle.filter !== 'none' || /paint|layout|strict|content/.test(parentStyle.contain)) {
                    transformedAncestor = true; break;
                }
            }
            if (modal || popover || !transformedAncestor) {
                const properties: Record<string, string> = {
                    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
                    right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px`,
                    margin: '0', transform: 'none', 'box-sizing': 'border-box',
                };
                Object.entries(properties).forEach(([name, value]) => copy.style.setProperty(name, value, 'important'));
            }
            if (modal || popover) {
                const z = 2147483000 + layer++ * 2;
                copy.style.setProperty('z-index', String(z + 1), 'important');
                // Top-layer nodes ignore ancestor clipping in the live page.
                clone.querySelector('body')!.appendChild(copy);
                const backdropStyle = view.getComputedStyle(element, '::backdrop');
                const backdrop = source.createElement('div');
                backdrop.setAttribute('data-html2svg-backdrop', '');
                backdrop.style.cssText = `position:fixed;inset:0;z-index:${z};pointer-events:none;`;
                for (const name of ['background-color', 'background-image', 'backdrop-filter', 'opacity']) {
                    backdrop.style.setProperty(name, backdropStyle.getPropertyValue(name));
                }
                copy.before(backdrop);
            }
        });
        // Fixed-only application mounts otherwise have a zero-height body.
        const body = source.body;
        const bodyCopy = clone.querySelector<HTMLElement>('body');
        if (body && bodyCopy && body.getBoundingClientRect().height < view.innerHeight) {
            bodyCopy.style.setProperty('min-height', `${view.innerHeight}px`);
        }
    }
    clone.querySelectorAll('script, noscript, base').forEach(node => node.remove());
    clone.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        });
        if (node.hasAttribute('srcset')) {
            node.setAttribute('srcset', node.getAttribute('srcset')!.replace(/(^|,\s*)((?:\/(?!\/)|https?:\/\/)[^\s,]+)/gi, (match, separator, raw) => {
                try { return separator + resolveResource(raw); } catch { return match; }
            }));
        }
        if (node.hasAttribute('style')) {
            node.setAttribute('style', node.getAttribute('style')!.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, _quote, raw) => {
                if (/^(data:|blob:|#)/i.test(raw)) return match;
                try { return `url("${resolveResource(raw)}")`; } catch { return match; }
            }));
        }
        ['src', 'href', 'action', 'poster'].forEach(attr => {
            const raw = node.getAttribute(attr);
            if (!raw || /^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(raw)) return;
            try { node.setAttribute(attr, resolveResource(raw)); } catch {}
        });
    });
    return { html: '<!DOCTYPE html>\n' + clone.outerHTML, url: source.URL };
}
