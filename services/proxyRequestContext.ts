/** Recover escaped root URLs from their requesting page, never a global last target. */
export function proxyContextFromReferer(referer: string | undefined) {
    if (!referer) return null;
    try {
        const path = new URL(referer).pathname;
        const remote = path.match(/^\/proxy-url\/([^/]+)(?:\/|$)/);
        if (remote) return { targetOrigin: new URL(decodeURIComponent(remote[1])).origin, proxyPrefix: `/proxy-url/${remote[1]}` };
        const local = path.match(/^\/proxy\/(\d+)(?:\/|$)/);
        if (local) return { targetOrigin: `http://127.0.0.1:${local[1]}`, proxyPrefix: `/proxy/${local[1]}` };
    } catch { /* not a proxy page */ }
    return null;
}
