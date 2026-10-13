import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(
    readFileSync(new URL('../services/svgClipboardService.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
function service(context) {
    const exports = {};
    runInNewContext(code, { exports, ...context });
    return exports.copySvgToClipboard;
}

test('clipboard receives SVG markup without XML/BOM/comment prefixes', async () => {
    let value;
    const copy = service({ navigator: { clipboard: { writeText: async text => { value = text; } } } });
    await copy('\uFEFF<?xml version="1.0"?>\n<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
    assert.equal(value, '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
    await assert.rejects(copy(''), /没有有效的 SVG/);
});

test('HTTP/permission fallback copies the SVG and cleans up even when copying fails', async () => {
    for (const success of [true, false]) {
        let removed = false;
        let restoredFocus = false;
        let selected = false;
        const textarea = {
            style: {}, setAttribute() {}, select() { selected = true; }, remove() { removed = true; },
        };
        const copy = service({
            navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
            window: { getSelection: () => null },
            document: {
                activeElement: { focus() { restoredFocus = true; } },
                createElement: () => textarea,
                body: { appendChild() {} },
                execCommand(command) {
                    assert.equal(command, 'copy');
                    assert.equal(selected, true);
                    assert.equal(textarea.value, '<svg></svg>');
                    return success;
                },
            },
        });
        if (success) await copy('<svg></svg>');
        else await assert.rejects(copy('<svg></svg>'), /浏览器未允许复制/);
        assert.equal(removed, true);
        assert.equal(restoredFocus, true);
    }
});
