import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('../services/proxyRequestContext.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports, URL });
const { proxyContextFromReferer } = exports;
test('converter requests never inherit another tab’s proxy context', () => {
    assert.equal(proxyContextFromReferer('http://127.0.0.1:36782/'), null);
    assert.equal(proxyContextFromReferer(undefined), null);
    assert.equal(proxyContextFromReferer('invalid'), null);
});
test('escaped nested-frame requests recover only their own target', () => {
    const context = proxyContextFromReferer('http://localhost:36782/proxy-url/http%3A%2F%2F10.10.28.129%3A10882/Custom-Dashboard-Management/login/home/home.html');
    assert.equal(context.targetOrigin, 'http://10.10.28.129:10882');
    assert.equal(context.proxyPrefix, '/proxy-url/http%3A%2F%2F10.10.28.129%3A10882');
    assert.equal(proxyContextFromReferer('http://localhost:36782/proxy/5173/src/App.tsx').targetOrigin, 'http://127.0.0.1:5173');
});
