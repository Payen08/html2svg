/** Install before page scripts so dynamically created frames stay in the proxy. */
export function installProxyFrameGuards(proxifyUrl: (url: string) => string): void {
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (srcDescriptor?.set) {
        const originalSetter = srcDescriptor.set;
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            ...srcDescriptor,
            set(value: string) {
                originalSetter.call(this, proxifyUrl(String(value)));
            },
        });
    }

    // React assigns iframe URLs through setAttribute rather than the src setter.
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name: string, value: string) {
        return originalSetAttribute.call(
            this,
            name,
            this.tagName === 'IFRAME' && name.toLowerCase() === 'src'
                ? proxifyUrl(String(value))
                : value
        );
    };
}
