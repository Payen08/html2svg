import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { create } from 'fontkit';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadModule(relativePath) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    runInNewContext(code, { exports, require, Buffer });
    return exports;
}
const { getLocalPingFangFont } = loadModule('../services/localFigmaFont.ts');
const { pingFangWeight, normalizePingFangNames } = loadModule('../services/figmaTextFontService.ts');

test('system PingFang faces contain real Chinese glyphs and a valid single-font checksum', { skip: process.platform !== 'darwin' }, () => {
    for (const weight of [100, 200, 300, 400, 500, 600, 700]) {
        const { bytes, weight: resolvedWeight, style } = getLocalPingFangFont(weight);
        const font = create(bytes);
        assert.equal(font.familyName, 'PingFang SC');
        assert.equal(font.subfamilyName, style);
        assert.equal(font.postscriptName, 'PingFangSC-' + style);
        assert.equal(resolvedWeight, Math.min(weight, 600));
        assert.ok(font.glyphsForString('自动布局文字测试 Hello').every(glyph => glyph.id !== 0));
        let checksum = 0;
        for (let index = 0; index < bytes.length; index += 4) checksum = (checksum + bytes.readUInt32BE(index)) >>> 0;
        assert.equal(checksum, 0xB1B0AFBA);
    }
});

test('weights and Figma style names match installed PingFang faces', () => {
    assert.equal(pingFangWeight(700), 600);
    assert.equal(pingFangWeight(400), 400);
    const nodes = [
        { type: 'FRAME' },
        { type: 'TEXT', fontName: { family: 'PingFang SC', style: 'SemiBold', postscript: 'PingFangSC-Semibold' } },
        { type: 'TEXT', fontName: { family: 'PingFang SC', style: 'Thin', postscript: 'PingFangSC-Ultralight' } },
    ];
    normalizePingFangNames(nodes);
    assert.equal(nodes[1].fontName.style, 'Semibold');
    assert.equal(nodes[2].fontName.style, 'Ultralight');
});
