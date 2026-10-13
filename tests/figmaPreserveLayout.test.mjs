import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { encodeFigmaData, decodeFigmaData } from '@figit/fig-kiwi';

const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('../services/figmaPreserveLayoutService.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const guid = id => ({ sessionID: 0, localID: id });
const matrix = (x, y) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });

function setup(transform = 'matrix(0.75,0,0,0.75,0,0)') {
    const scaled = { transform, parentElement: null };
    const element = { transform: 'none', parentElement: scaled };
    const root = {
        querySelector: () => element,
        ownerDocument: { defaultView: { getComputedStyle: el => ({ transform: el.transform || 'none' }) } },
    };
    const frame = { type: 'FRAME', guid: guid(2), name: 'Portrait', parentIndex: { guid: guid(1), position: '0' }, size: { x: 1080, y: 1920 }, stackMode: 'VERTICAL' };
    const modal = { type: 'FRAME', guid: guid(3), name: 'Modal', parentIndex: { guid: guid(2), position: '0' }, size: { x: 600, y: 400 }, transform: matrix(100, 300), stackMode: 'VERTICAL', stackChildAlignSelf: 'STRETCH', stackChildPrimaryGrow: 1 };
    const text = {
        type: 'TEXT', guid: guid(4), name: 'Text', characters: 'Test', parentIndex: { guid: guid(3), position: '0' },
        size: { x: 150, y: 45 }, transform: matrix(10, 0), fontSize: 40,
        lineHeight: { units: 'PIXELS', value: 60 }, letterSpacing: { units: 'PIXELS', value: 2 }, textAutoResize: 'HEIGHT',
        derivedTextData: { derivedLines: [{ directionality: 'LTR' }], layoutSize: { x: 200, y: 60 }, baselines: [{ position: { x: 0, y: 40 }, width: 200, lineY: 0, lineHeight: 60, lineAscent: 40, firstCharacter: 0, endCharacter: 4 }], glyphs: [{ position: { x: 40, y: 20 }, fontSize: 40, commandsBlob: 0, firstCharacter: 0, advance: 1, rotation: 0 }] },
    };
    const result = { document: { nodeChanges: [frame, modal, text], blobs: [] }, trace: { rootGuid: guid(2), entries: [
        { guid: guid(3), domPath: 'modal', rect: { x: 240, y: 500, width: 600, height: 400 } },
        { guid: guid(4), domPath: 'modal::text[0]', rect: { x: 250, y: 490, width: 150, height: 45 } },
    ] } };
    exports.preserveFigmaLayout(root, result, 1080, 1920);
    return decodeFigmaData(encodeFigmaData(result.document).figBytes).message.nodeChanges;
}

test('portrait export keeps a fixed viewport and exact overlay positions, including negative text offsets', () => {
    const [frame, modal, text] = setup();
    assert.deepEqual(frame.size, { x: 1080, y: 1920 });
    assert.equal(frame.stackMode, 'NONE');
    assert.equal(modal.stackMode, 'NONE');
    assert.equal(modal.stackChildAlignSelf, undefined);
    assert.equal(modal.stackChildPrimaryGrow, undefined);
    assert.equal(modal.transform.m02, 240);
    assert.equal(modal.transform.m12, 500);
    assert.equal(text.transform.m02, 10);
    assert.equal(text.transform.m12, -10);
    assert.equal(text.textAutoResize, 'NONE');
});

test('uniform CSS scale keeps editable font, line height and glyph data proportional', () => {
    const text = setup()[2];
    assert.equal(text.fontSize, 30);
    assert.equal(text.lineHeight.value, 45);
    assert.equal(text.letterSpacing.value, 1.5);
    assert.deepEqual(text.derivedTextData.layoutSize, { x: 150, y: 45 });
    assert.equal(text.derivedTextData.baselines[0].position.y, 30);
    assert.equal(text.derivedTextData.glyphs[0].fontSize, 30);
    assert.equal(text.derivedTextData.glyphs[0].position.x, 30);
});

test('translation does not change font metrics', () => {
    const text = setup('matrix(1,0,0,1,120,240)')[2];
    assert.equal(text.fontSize, 40);
    assert.equal(text.lineHeight.value, 60);
});
