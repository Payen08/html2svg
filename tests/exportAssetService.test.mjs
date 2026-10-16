import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(new URL('../services/exportAssetService.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

function loaderWith(fetch, baseUrl) {
    const exports = {};
    runInNewContext(code, { exports, fetch, Uint8Array, TextDecoder, btoa, URL });
    return exports.createExportAssetLoader(baseUrl);
}

test('SVG icons return vector source and repeated assets share one fetch', async () => {
    let calls = 0;
    const source = '<svg viewBox="0 0 16 16"><path d="M0 0L16 16"/></svg>';
    const loader = loaderWith(async () => {
        calls++;
        return new Response(source, { headers: { 'content-type': 'image/svg+xml' } });
    });
    const [first, second] = await Promise.all([loader('http://local/icon.svg'), loader('http://local/icon.svg')]);
    assert.equal(first.kind, 'svg');
    assert.equal(first.source, source);
    assert.equal(first, second);
    assert.equal(calls, 1);
});

test('bitmap bytes become embedded data URLs rather than external links', async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const loader = loaderWith(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    const asset = await loader('http://local/avatar.png');
    assert.equal(asset.kind, 'image');
    assert.equal(asset.source, 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'));
});

test('missing assets and HTML fallbacks fail instead of exporting broken image references', async () => {
    const missing = loaderWith(async () => new Response('', { status: 404 }));
    await assert.rejects(missing('http://local/icon.svg'), /404/);
    const fallback = loaderWith(async () => new Response('<html>wrong page</html>', { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(fallback('http://local/icon.svg'), /SVG 图标内容无效/);
});

test('escaped Chinese root assets resolve through their own capture proxy and share a cache', async()=>{
 const base='http://127.0.0.1:53943/proxy-url/http%3A%2F%2F10.10.28.129%3A10882/app/page.html';
 const calls=[];const loader=loaderWith(async url=>{calls.push(url);return new Response(Uint8Array.from([137,80,78,71]),{headers:{'content-type':'image/png'}})},base);
 await loader('http://127.0.0.1:53943/%E5%A2%A8%E5%BD%B1logo.png');
 await loader('/墨影logo.png');
 assert.deepEqual(calls,['http://127.0.0.1:53943/proxy-url/http%3A%2F%2F10.10.28.129%3A10882/%E5%A2%A8%E5%BD%B1logo.png']);
});
test('proxy repair keeps relative paths, query strings and other origins isolated', async()=>{
 const calls=[];const loader=loaderWith(async url=>{calls.push(url);return new Response('',{headers:{'content-type':'image/png'}})},'http://127.0.0.1:53943/proxy/5173/app/page.html');
 await loader('../logo.png?v=2');await loader('http://127.0.0.1:5173/logo.png?v=3');await loader('https://cdn.example.com/logo.png');await loader('http://127.0.0.1:53943/proxy/9000/logo.png');
 assert.deepEqual(calls,['http://127.0.0.1:53943/proxy/5173/logo.png?v=2','http://127.0.0.1:53943/proxy/5173/logo.png?v=3','https://cdn.example.com/logo.png','http://127.0.0.1:53943/proxy/9000/logo.png']);
});
