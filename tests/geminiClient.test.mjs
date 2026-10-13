import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadServices(apiKey) {
  let constructions = 0;
  let requests = 0;
  const cache = new Map();
  class GoogleGenAI {
    constructor(options) {
      constructions++;
      assert.equal(options.apiKey, 'test-key');
    }
    models = {
      generateContent: async () => {
        requests++;
        return { text: '{"html":"<main>Test</main>","css":""}' };
      },
    };
  }
  const load = name => {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const source = readFileSync(new URL(`../services/${name}.ts`, import.meta.url), 'utf8')
      .replaceAll('import.meta.env', '__env');
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, {
      exports,
      __env: { VITE_GEMINI_API_KEY: apiKey },
      console,
      require: name => name === '@google/genai' ? { GoogleGenAI } : load(name.replace('./', '')),
    });
    return exports;
  };
  return { load, constructions: () => constructions, requests: () => requests };
}

test('both AI services can load without a key; conversion reports the configuration error', async () => {
  for (const key of [undefined, '', '   ']) {
    const services = loadServices(key);
    const { convertHtmlToSvg } = services.load('geminiService');
    const { convertSvgToHtml } = services.load('svg2htmlService');
    assert.equal(services.constructions(), 0);
    await assert.rejects(convertHtmlToSvg('<main>Test</main>'), /VITE_GEMINI_API_KEY.*重启/);
    await assert.rejects(convertSvgToHtml('<svg/>'), /VITE_GEMINI_API_KEY.*重启/);
    assert.equal(services.requests(), 0);
  }
});

test('AI services initialize on demand and share a client with a trimmed key', async () => {
  const services = loadServices(' test-key ');
  const { convertHtmlToSvg } = services.load('geminiService');
  const { convertSvgToHtml } = services.load('svg2htmlService');
  assert.equal(services.constructions(), 0);
  await convertHtmlToSvg('<main>Test</main>');
  const result = await convertSvgToHtml('<svg/>');
  assert.equal(result.html, '<main>Test</main>');
  assert.equal(services.constructions(), 1);
  assert.equal(services.requests(), 2);
});
