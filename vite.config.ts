import { proxyContextFromReferer } from './services/proxyRequestContext';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { rewriteProxyBrowserRouters } from './services/proxyRouterCompat';
import { installProxyFrameGuards } from './services/proxyFrameCompat';
import { selectCaptureDocument, serializeCaptureDocument } from './services/captureSnapshot';
import { getLocalPingFangFont } from './services/localFigmaFont';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    base: mode === 'production' ? '/html2svg/' : '/',
    server: {
      port: 36782,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      {
        name: 'local-api-server',
        configureServer(server) {
          const ALLOWED_EXT = [
            '.html', '.htm', '.css', '.js', '.mjs', '.json',
            '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
            '.woff', '.woff2', '.ttf', '.otf', '.eot',
            '.xml', '.txt', '.md',
          ];
          const BLOCKED = ['.env', '.git', 'node_modules', '.ssh', '.aws', 'id_rsa', 'id_ed25519', 'known_hosts'];
          const CORS = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          };

          const sendError = (res: any, status: number, message: string) => {
            res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: message }));
          };


          const isLocalOrPrivateHost = (hostname: string) => {
            if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(hostname)) return true;
            return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(hostname);
          };

          const isAllowedProxyHost = (hostname: string) => Boolean(hostname);

          const viteClientStub = `
const __html2svgStyles = new Map();
const __html2svgProxyPrefix = (() => {
  try {
    const path = new URL(import.meta.url).pathname;
    const proxyUrlMatch = path.match(/^(\\/proxy-url\\/[^/]+)\\//);
    if (proxyUrlMatch) return proxyUrlMatch[1];
    const proxyMatch = path.match(/^(\\/proxy\\/\\d+)\\//);
    if (proxyMatch) return proxyMatch[1];
  } catch {}
  return '';
})();
const __html2svgRewriteCssUrls = (css) => {
  if (!__html2svgProxyPrefix || typeof css !== 'string') return css;
  return css
    .replace(/url\\((["']?)\\/(?!\\/|proxy\\/|proxy-url\\/)/g, 'url($1' + __html2svgProxyPrefix + '/')
    .replace(/(@import\\s+(?:url\\()?\\s*["'])\\/(?!\\/|proxy\\/|proxy-url\\/)/g, '$1' + __html2svgProxyPrefix + '/');
};
export const injectQuery = (url) => url;
export const createHotContext = () => ({
  data: {},
  accept: () => {},
  dispose: () => {},
  prune: () => {},
  decline: () => {},
  invalidate: () => {},
  on: () => {},
  off: () => {},
  send: () => {},
});
export const updateStyle = (id, content) => {
  if (typeof document === 'undefined') return;
  var style = __html2svgStyles.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    __html2svgStyles.set(id, style);
    document.head.appendChild(style);
  }
  style.textContent = __html2svgRewriteCssUrls(content);
};
export const removeStyle = (id) => {
  var style = __html2svgStyles.get(id);
  if (!style) return;
  style.remove();
  __html2svgStyles.delete(id);
};
export const HMRContext = class {};
export default {};
`;

          const reactRefreshStub = `
export function injectIntoGlobalHook() {}
export function register(type) {
  return type;
}
export function getRefreshReg(filename) {
  return (type, id) => register(type, filename + ' ' + id);
}
export function getRefreshSig() {
  return createSignatureFunctionForTransform();
}
export function createSignatureFunctionForTransform() {
  return (type) => type;
}
export function performReactRefresh() {}
export function __hmr_import(url) {
  return import(url);
}
export function registerExportsForReactRefresh() {}
export function isLikelyComponentType() {
  return false;
}
export function getFamilyByID() {
  return undefined;
}
export function getFamilyByType() {
  return undefined;
}
export function validateRefreshBoundaryAndEnqueueUpdate() {
  return undefined;
}
export default {
  injectIntoGlobalHook,
  register,
  getRefreshReg,
  getRefreshSig,
  createSignatureFunctionForTransform,
  performReactRefresh,
  __hmr_import,
  registerExportsForReactRefresh,
  isLikelyComponentType,
  getFamilyByID,
  getFamilyByType,
  validateRefreshBoundaryAndEnqueueUpdate,
};
`;

          const sendViteRuntimeStub = (requestPath: string, res: any) => {
            const cleanPath = requestPath.split('?')[0];
            const source = cleanPath.endsWith('/@vite/client')
              ? viteClientStub
              : cleanPath.endsWith('/@react-refresh')
                ? reactRefreshStub
                : null;

            if (!source) return false;

            res.writeHead(200, {
              ...CORS,
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-cache',
            });
            res.end(source);
            return true;
          };

          const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const createRewriters = (targetOrigin: string, proxyPrefix: string) => {
            const proxiedPath = `${proxyPrefix}/`;
            const targetOriginPattern = new RegExp(escapeRegExp(targetOrigin) + '(?=/|["\'`)\\s])', 'g');
            const shouldSkipRootPath = (pathValue: string) => (
              pathValue.startsWith('/proxy/')
              || pathValue.startsWith('/proxy-url/')
              || pathValue.startsWith('//')
              || pathValue.startsWith('/__html2svg_internal__/')
            );

            const toProxyPath = (pathValue: string) => {
              if (shouldSkipRootPath(pathValue)) return pathValue;
              return `${proxyPrefix}${pathValue}`;
            };

            const rewriteTargetOrigin = (source: string) => source.replace(targetOriginPattern, proxyPrefix);

            const rewriteJs = (source: string) => {
              let next = rewriteTargetOrigin(source);

              next = next
                .replace(/(\bfrom\s*["'])\/(?!\/)([^"']*)/g, (_m, prefix, rest) => `${prefix}${toProxyPath('/' + rest)}`)
                .replace(/(\bimport\s*["'])\/(?!\/)([^"']*)/g, (_m, prefix, rest) => `${prefix}${toProxyPath('/' + rest)}`)
                .replace(/(\bimport\s*\(\s*["'])\/(?!\/)([^"']*)/g, (_m, prefix, rest) => `${prefix}${toProxyPath('/' + rest)}`)
                .replace(/(new\s+URL\(\s*["'])\/(?!\/)([^"']*)/g, (_m, prefix, rest) => `${prefix}${toProxyPath('/' + rest)}`)
                .replace(/(\bfetch\(\s*["'])\/(?!\/)([^"']*)/g, (_m, prefix, rest) => `${prefix}${toProxyPath('/' + rest)}`)
                .replace(/(\baxios\.\w+\(\s*["'])\/(?!\/)([^"']*)/g, (_m, prefix, rest) => `${prefix}${toProxyPath('/' + rest)}`);

              // Vite emits string constants such as "/src/styles.css" in transformed modules.
              next = next.replace(/(["'`])\/(?!\/|proxy\/|proxy-url\/)(src|assets|node_modules|@fs|@id|@react-refresh|@vite\/client|vite|@[^"'`]*)/g, (_m, quote, rest) => {
                return `${quote}${proxyPrefix}/${rest}`;
              });

              return rewriteProxyBrowserRouters(next, proxyPrefix);
            };

            const rewriteCss = (source: string) => rewriteTargetOrigin(source)
              .replace(/url\((["']?)\/(?!\/|proxy\/|proxy-url\/)/gi, `url($1${proxiedPath}`)
              .replace(/(@import\s+(?:url\()?\s*["'])\/(?!\/|proxy\/|proxy-url\/)/gi, `$1${proxiedPath}`);

            const rewriteHtml = (source: string) => {
              const rewriteSrcset = (value: string) => value.split(',').map((item) => {
                const leading = item.match(/^\s*/)?.[0] || '';
                const trimmed = item.trim();
                if (trimmed.startsWith('/') && !shouldSkipRootPath(trimmed)) {
                  return `${leading}${proxyPrefix}${trimmed}`;
                }
                return item;
              }).join(',');

              return rewriteCss(rewriteJs(source))
                .replace(/<base\b[^>]*\/?>/gi, '')
                .replace(/\b(src|href|action|poster)=(["'])\/(?!\/)(.*?)\2/gi, (_m, attr, quote, value) => {
                  return `${attr}=${quote}${toProxyPath('/' + value)}${quote}`;
                })
                .replace(/\b(srcset)=(["'])(.*?)\2/gi, (_m, attr, quote, value) => {
                  return `${attr}=${quote}${rewriteSrcset(value)}${quote}`;
                });
            };

            return { rewriteJs, rewriteCss, rewriteHtml, toProxyPath };
          };

          const buildCaptureScript = (targetOrigin: string, proxyPrefix: string) => `
<script data-html2svg-capture>
(function() {
  var proxyPrefix = ${JSON.stringify(proxyPrefix)};
  var targetOrigins = ${JSON.stringify([targetOrigin])};
  function shouldIgnoreUrl(value) {
    return !value || /^#/.test(value) || /^(javascript|mailto|tel|data|blob):/i.test(value);
  }
  function proxifyUrl(value) {
    if (shouldIgnoreUrl(value)) return value;
    try {
      var resolved = new URL(value, window.location.href);
      var nextPath = resolved.pathname + resolved.search + resolved.hash;
      if (targetOrigins.indexOf(resolved.origin) !== -1) return proxyPrefix + nextPath;
      if (resolved.origin === window.location.origin) {
        // Router links already include their proxy basename. Keep them stable:
        // wrapping them again would also trigger an endless href mutation loop.
        if (
          resolved.pathname === proxyPrefix ||
          resolved.pathname.indexOf(proxyPrefix + '/') === 0 ||
          resolved.pathname.indexOf('/proxy/') === 0 ||
          resolved.pathname.indexOf('/proxy-url/') === 0
        ) return nextPath;
        return proxyPrefix + nextPath;
      }
      if (/^https?:$/.test(resolved.protocol)) {
        return '/proxy-url/' + encodeURIComponent(resolved.origin) + nextPath;
      }
    } catch(e) {}
    return value;
  }
  function rewriteElementUrl(el, attr) {
    var raw = el.getAttribute(attr);
    var next = proxifyUrl(raw);
    if (next !== raw) el.setAttribute(attr, next);
  }
  (${installProxyFrameGuards.toString()})(proxifyUrl);
  function rewriteNavigations(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), function(anchor) {
      rewriteElementUrl(anchor, 'href');
    });
    if (root.tagName === 'IFRAME') rewriteElementUrl(root, 'src');
    Array.prototype.forEach.call(root.querySelectorAll('iframe[src]'), function(frame) {
      rewriteElementUrl(frame, 'src');
    });
    Array.prototype.forEach.call(root.querySelectorAll('form[action]'), function(form) {
      rewriteElementUrl(form, 'action');
    });
  }
  function installNavigationGuards() {
    try {
      var originalPushState = history.pushState;
      history.pushState = function(state, title, nextUrl) {
        return originalPushState.call(this, state, title, nextUrl == null ? nextUrl : proxifyUrl(String(nextUrl)));
      };
    } catch(e) {}
    try {
      var originalReplaceState = history.replaceState;
      history.replaceState = function(state, title, nextUrl) {
        return originalReplaceState.call(this, state, title, nextUrl == null ? nextUrl : proxifyUrl(String(nextUrl)));
      };
    } catch(e) {}
  }
  installNavigationGuards();
  rewriteNavigations(document);
  document.addEventListener('click', function(event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (anchor) rewriteElementUrl(anchor, 'href');
  }, true);
  document.addEventListener('submit', function(event) {
    var form = event.target;
    if (form && form.tagName === 'FORM') rewriteElementUrl(form, 'action');
  }, true);
  try {
    new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
          Array.prototype.forEach.call(mutation.addedNodes, function(node) {
            if (node.nodeType === 1) rewriteNavigations(node);
          });
        } else if (mutation.type === 'attributes') {
          rewriteNavigations(document);
        }
      });
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'action', 'src']
    });
  } catch(e) {}
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'html2svg-capture') {
      try {
        var captureDoc = (${selectCaptureDocument.toString()})(document);
        var snapshot = (${serializeCaptureDocument.toString()})(captureDoc);
        var target = event.source || window.parent;
        target.postMessage({ type: 'html2svg-capture-result', html: snapshot.html, url: snapshot.url }, '*');
      } catch(e) {
        var errorTarget = event.source || window.parent;
        errorTarget.postMessage({ type: 'html2svg-capture-error', error: e.message }, '*');
      }
    }
  });
})();
</script>`;

          const handleProxy = async (req: any, res: any, targetOrigin: string, targetPath: string, proxyPrefix: string) => {
            if (sendViteRuntimeStub(targetPath, res)) return;

            const targetUrl = `${targetOrigin}${targetPath}`;
            const { rewriteJs, rewriteCss, rewriteHtml } = createRewriters(targetOrigin, proxyPrefix);

            try {
              const response = await fetch(targetUrl, {
                method: req.method || 'GET',
                headers: {
                  Accept: req.headers.accept || '*/*',
                },
              });
              const contentType = response.headers.get('content-type') || 'application/octet-stream';
              const headers: Record<string, string> = {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=0',
                'X-Frame-Options': 'SAMEORIGIN',
              };

              const body = await response.arrayBuffer();
              let bodyBuffer = Buffer.from(body);

              if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
                let html = rewriteHtml(bodyBuffer.toString('utf-8'));
                const captureScript = buildCaptureScript(targetOrigin, proxyPrefix);
                // Frame setters must be guarded before the target's scripts run.
                if (/<head\b[^>]*>/i.test(html)) {
                  html = html.replace(/<head\b[^>]*>/i, (head) => head + '\n' + captureScript);
                } else if (/<\/body>/i.test(html)) {
                  html = html.replace(/<\/body>/i, captureScript + '\n</body>');
                } else if (/<\/html>/i.test(html)) {
                  html = html.replace(/<\/html>/i, captureScript + '\n</html>');
                } else {
                  html += captureScript;
                }
                bodyBuffer = Buffer.from(html, 'utf-8');
                headers['Content-Length'] = String(bodyBuffer.length);
              } else if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
                const transformed = rewriteJs(bodyBuffer.toString('utf-8'));
                bodyBuffer = Buffer.from(transformed, 'utf-8');
                headers['Content-Length'] = String(bodyBuffer.length);
              } else if (contentType.includes('text/css')) {
                const transformed = rewriteCss(bodyBuffer.toString('utf-8'));
                bodyBuffer = Buffer.from(transformed, 'utf-8');
                headers['Content-Length'] = String(bodyBuffer.length);
              }

              res.writeHead(response.status, headers);
              res.end(bodyBuffer);
            } catch (e: any) {
              res.writeHead(502, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
              res.end(`Proxy error: cannot reach ${targetOrigin}: ${e.message || e}`);
            }
          };

          server.middlewares.use(async (req, res, next) => {
            const rawUrl = req.url || '';

            if (rawUrl.startsWith('/api/figma-font')) {
              try {
                const weight = Number(new URL(rawUrl, 'http://local').searchParams.get('weight')) || 400;
                const font = getLocalPingFangFont(weight);
                res.writeHead(200, {
                  ...CORS, 'Content-Type': 'font/ttf',
                  'X-Font-Weight': String(font.weight), 'X-Font-Style': font.style,
                  'Cache-Control': 'private, max-age=3600',
                });
                res.end(font.bytes);
              } catch (error) {
                sendError(res, 503, error instanceof Error ? error.message : '无法读取 PingFang SC 字体。');
              }
              return;
            }

            const requestContext = proxyContextFromReferer(req.headers.referer);
            if (requestContext && !/^\/(?:proxy|proxy-url|__html2svg_internal__)(?:\/|$)/.test(rawUrl)
                && isAllowedProxyHost(new URL(requestContext.targetOrigin).hostname)) {
              // A proxied page can navigate an iframe with an unprefixed root URL.
              // Redirect to restore the prefix before Vite's SPA fallback serves our app.
              res.writeHead(307, { Location: requestContext.proxyPrefix + rawUrl });
              res.end();
              return;
            }

            const proxyUrlMatch = rawUrl.match(/^\/proxy-url\/([^/]+)(\/.*)?$/);
            if (proxyUrlMatch) {
              const encodedOrigin = proxyUrlMatch[1];
              const targetPath = proxyUrlMatch[2] || '/';
              try {
                const parsedOrigin = new URL(decodeURIComponent(encodedOrigin));
                if (!['http:', 'https:'].includes(parsedOrigin.protocol) || !isAllowedProxyHost(parsedOrigin.hostname)) {
                  sendError(res, 403, 'Only valid http/https origins are allowed.');
                  return;
                }
                const proxyPrefix = `/proxy-url/${encodedOrigin}`;
                await handleProxy(req, res, parsedOrigin.origin, targetPath, proxyPrefix);
              } catch {
                sendError(res, 400, 'Invalid proxy origin.');
              }
              return;
            }

            const proxyMatch = rawUrl.match(/^\/proxy\/(\d+)(\/.*)?$/);
            if (proxyMatch) {
              const port = proxyMatch[1];
              const targetPath = proxyMatch[2] || '/';
              const targetOrigin = `http://127.0.0.1:${port}`;
              const proxyPrefix = `/proxy/${port}`;
              await handleProxy(req, res, targetOrigin, targetPath, proxyPrefix);
              return;
            }

            if (rawUrl.startsWith('/api/read-local-file')) {
              const p = new URL(rawUrl, 'http://x').searchParams.get('path');
              if (!p) { sendError(res, 400, 'Missing path'); return; }
              const normalized = path.normalize(p);
              if (BLOCKED.some(b => normalized.toLowerCase().includes(b))) { sendError(res, 403, 'Blocked'); return; }
              if (!ALLOWED_EXT.includes(path.extname(normalized).toLowerCase())) { sendError(res, 403, 'Bad ext'); return; }
              try {
                const stat = fs.statSync(normalized);
                if (!stat.isFile() || stat.size > 10 * 1024 * 1024) { sendError(res, 400, 'Bad file'); return; }
                res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(fs.readFileSync(normalized, 'utf-8'));
              } catch (e: any) {
                sendError(res, 404, e.message);
              }
              return;
            }

            if (rawUrl.startsWith('/api/fetch-local-url')) {
              const target = new URL(rawUrl, 'http://x').searchParams.get('url');
              if (!target) { sendError(res, 400, 'Missing url'); return; }
              let parsedTarget: URL;
              try { parsedTarget = new URL(target); } catch { sendError(res, 400, 'Invalid URL'); return; }
              if (!isLocalOrPrivateHost(parsedTarget.hostname)) { sendError(res, 403, 'Not local'); return; }

              const urls = [target];
              if (parsedTarget.hostname === 'localhost') urls.unshift(target.replace('localhost', '127.0.0.1'));
              let lastError = '';
              for (const candidate of urls) {
                try {
                  const response = await fetch(candidate, { headers: { Accept: 'text/html,application/xhtml+xml' } });
                  if (!response.ok) throw new Error('HTTP ' + response.status);
                  const arrayBuffer = await response.arrayBuffer();
                  let html = new TextDecoder('utf-8').decode(arrayBuffer);
                  const charsetMatch = html.match(/charset=["']?([^"'\s>]+)/i);
                  if (charsetMatch && charsetMatch[1].toLowerCase() !== 'utf-8') {
                    try { html = new TextDecoder(charsetMatch[1]).decode(arrayBuffer); } catch {}
                  }
                  if (!html.includes('charset')) html = html.replace(/<head([^>]*)>/i, '<head$1><meta charset="UTF-8">');
                  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
                  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ html, url: candidate, title: titleMatch ? titleMatch[1].trim() : undefined, status: response.status }));
                  return;
                } catch (e: any) {
                  lastError = e.message;
                }
              }
              sendError(res, 502, 'Cannot reach: ' + lastError);
              return;
            }

            next();
          });
        },
      },
    ],
    define: {
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || ''),
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
