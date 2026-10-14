import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(new URL('../services/captureSnapshot.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
const exports = {};
runInNewContext(code, { exports });
const { selectCaptureDocument } = exports;

function documentWith(frames = []) {
    return {
        body: {}, readyState: 'complete',
        defaultView: {
            innerWidth: 1920, innerHeight: 1080,
            getComputedStyle: frame => frame.style || { display: 'block', visibility: 'visible', opacity: '1' },
        },
        querySelectorAll: () => frames,
    };
}
function frameWith(child, width = 1920, height = 1080) {
    return { contentDocument: child, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
}

test('capture follows multiple full-page frame wrappers to the live inner document', () => {
    const inner = documentWith();
    const middle = documentWith([frameWith(inner)]);
    const outer = documentWith([frameWith(middle)]);
    assert.equal(selectCaptureDocument(outer), inner);
});

test('small widgets and hidden frames do not replace the parent capture', () => {
    const widget = frameWith(documentWith(), 300, 200);
    const hidden = frameWith(documentWith());
    hidden.style = { display: 'none', visibility: 'visible', opacity: '1' };
    const outer = documentWith([widget, hidden]);
    assert.equal(selectCaptureDocument(outer), outer);
});

test('unreadable or loading full-page frames fail explicitly instead of capturing an empty wrapper', () => {
    assert.throws(() => selectCaptureDocument(documentWith([frameWith(null)])), /内嵌页面/);
    const loading = documentWith();
    loading.readyState = 'loading';
    assert.throws(() => selectCaptureDocument(documentWith([frameWith(loading)])), /尚未加载完成/);
});

test('snapshots keep current form values and mask password fields',()=>{
    const inputs=[{tagName:'INPUT',type:'text',value:'当前输入'},{tagName:'INPUT',type:'password',value:'private-password'}];
    const copies=inputs.map(input=>({tagName:input.tagName,values:new Map([['type',input.type]]),setAttribute(name,value){this.values.set(name,value)},getAttribute(name){return this.values.get(name)},get attributes(){return [...this.values].map(([name,value])=>({name,value}))}}));
    const clone={querySelectorAll(selector){return selector==='input, textarea, select'||selector==='*'?copies:[]},get outerHTML(){return '<html><body>'+copies.map(copy=>'<input '+[...copy.values].map(([name,value])=>name+'="'+value+'"').join(' ')+'>').join('')+'</body></html>'}};
    const source={documentElement:{cloneNode:()=>clone},querySelectorAll:()=>inputs,defaultView:null,URL:'https://example.com/form',baseURI:'https://example.com/form'};
    const snapshot=exports.serializeCaptureDocument(source);
    assert.match(snapshot.html,/当前输入/);assert.ok(!snapshot.html.includes('private-password'));
    assert.equal(copies[1].getAttribute('value'),'•'.repeat(inputs[1].value.length));
    assert.equal(snapshot.url,source.URL);
});
