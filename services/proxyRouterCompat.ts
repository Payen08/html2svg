/** Adapt browser routers in proxied Vite modules to the iframe's URL prefix. */
export function rewriteProxyBrowserRouters(source: string, proxyPrefix: string): string {
    const helper = '__html2svgProxyRouterBasename';
    if (source.includes(`function ${helper}(`)) return source;

    let rewritten = source.replace(
        /(function\s+createBrowserRouter\d*\s*\(\s*[\w$]+\s*,\s*([\w$]+)(?:\s*=\s*\{\s*\})?\s*\)\s*\{)/g,
        (_match, declaration, options) => `${declaration}\n${options} = { ...${options}, basename: ${helper}(${options}?.basename) };`
    );

    rewritten = rewritten.replace(
        /(function\s+BrowserRouter\d*\s*\(\s*\{([^{}]*)\}\s*\)\s*\{)/g,
        (match, declaration, props) => {
            if (!/(?:^|,)\s*basename\s*(?:,|$|=)/.test(props)) return match;
            return `${declaration}\nbasename = ${helper}(basename);`;
        }
    );

    if (rewritten === source) return source;

    // Preserve an application's existing basename, including its trailing slash.
    // HashRouter's basename belongs inside the hash and must remain untouched.
    return `${rewritten}\nfunction ${helper}(basename = '/') {
  const prefix = ${JSON.stringify(proxyPrefix)};
  if (basename === prefix || basename.startsWith(prefix + '/')) return basename;
  return prefix + (basename.startsWith('/') ? '' : '/') + basename;
}\n`;
}
