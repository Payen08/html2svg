import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(new URL('../services/proxyFrameCompat.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

function createEnvironment() {
    class Element {
        constructor(tagName) { this.tagName = tagName; this.attributes = {}; }
        setAttribute(name, value) { this.attributes[name] = value; }
    }
    class HTMLIFrameElement extends Element {
        constructor() { super('IFRAME'); }
        get src() { return this.attributes.src; }
        set src(value) { this.attributes.src = value; }
    }
    const exports = {};
    runInNewContext(code, { exports, Element, HTMLIFrameElement });
    const prefix = '/proxy-url/http%3A%2F%2F10.10.28.129%3A10882';
    exports.installProxyFrameGuards(value =>
        value.startsWith('/') && !value.startsWith(prefix + '/') ? prefix + value : value
    );
    return { Element, HTMLIFrameElement, prefix };
}

test('dynamic iframe src assignments retain the target path, query and hash', () => {
    const { HTMLIFrameElement, prefix } = createEnvironment();
    const frame = new HTMLIFrameElement();
    const path = '/Custom-Dashboard-Management/login/home/home.html?v=20261013-1#/home';
    frame.src = path;
    assert.equal(frame.src, prefix + path);
    frame.src = frame.src;
    assert.equal(frame.src, prefix + path);
});

test('React-style src attributes are rewritten without altering other attributes/elements', () => {
    const { Element, HTMLIFrameElement, prefix } = createEnvironment();
    const frame = new HTMLIFrameElement();
    frame.setAttribute('src', '/login/home.html');
    assert.equal(frame.src, prefix + '/login/home.html');
    frame.setAttribute('srcdoc', '<p>Inline preview</p>');
    assert.equal(frame.attributes.srcdoc, '<p>Inline preview</p>');
    frame.setAttribute('src', 'about:blank');
    assert.equal(frame.src, 'about:blank');
    const image = new Element('IMG');
    image.setAttribute('src', '/image.png');
    assert.equal(image.attributes.src, '/image.png');
});
