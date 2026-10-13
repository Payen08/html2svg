import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(new URL('../services/proxyRouterCompat.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
const exports = {};
runInNewContext(code, { exports });
const { rewriteProxyBrowserRouters } = exports;
const prefix = '/proxy-url/http%3A%2F%2F10.10.28.129%3A5173';

test('data router uses the proxy basename and preserves other options', () => {
    const source = `function createBrowserRouter(routes, opts) {
      return { routes, ...opts };
    }`;
    const context = {};
    runInNewContext(rewriteProxyBrowserRouters(source, prefix), context);
    assert.equal(context.createBrowserRouter([]).basename, prefix + '/');
    const result = context.createBrowserRouter([], { basename: '/app/', future: true });
    assert.equal(result.basename, prefix + '/app/');
    assert.equal(result.future, true);
    assert.equal(context.createBrowserRouter([], { basename: prefix + '/app' }).basename, prefix + '/app');
});

test('declarative browser router receives the local-port proxy basename', () => {
    const context = {};
    const source = `function BrowserRouter({ basename, children, window: window2 }) {
      return { basename, children, window2 };
    }`;
    runInNewContext(rewriteProxyBrowserRouters(source, '/proxy/5173'), context);
    assert.equal(context.BrowserRouter({}).basename, '/proxy/5173/');
    assert.equal(context.BrowserRouter({ basename: '/app' }).basename, '/proxy/5173/app');
});

test('hash routers and unrelated modules remain unchanged; rewrite is idempotent', () => {
    const hashRouter = `function createHashRouter(routes, opts) { return opts; }
      function HashRouter({ basename }) { return basename; }`;
    assert.equal(rewriteProxyBrowserRouters(hashRouter, prefix), hashRouter);
    const unrelated = 'export const path = "/mobile";';
    assert.equal(rewriteProxyBrowserRouters(unrelated, prefix), unrelated);
    const source = 'function createBrowserRouter(routes, opts = {}) { return opts; }';
    const rewritten = rewriteProxyBrowserRouters(source, prefix);
    assert.equal(rewriteProxyBrowserRouters(rewritten, prefix), rewritten);
});
