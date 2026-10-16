import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('packaged server serves offline assets, proxies pages and provides local fonts without Vite',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'html2svg-server-'));
 await writeFile(path.join(directory,'index.html'),'<html><head></head><body>Offline desktop fixture</body></html>');
 await writeFile(path.join(directory,'墨影logo.png'),Uint8Array.from([137,80,78,71]));
 await build({entryPoints:['services/exportAssetService.ts'],outfile:path.join(directory,'asset.mjs'),bundle:true,platform:'node',format:'esm'});
 const {createExportAssetLoader}=await import(pathToFileURL(path.join(directory,'asset.mjs')));
 await build({entryPoints:['desktop/server.ts'],outfile:path.join(directory,'server.mjs'),bundle:true,platform:'node',format:'esm'});
 const {startDesktopServer}=await import(pathToFileURL(path.join(directory,'server.mjs')));
 const {server,origin}=await startDesktopServer(directory);
 try{
  const app=await fetch(origin+'/');assert.equal(app.status,200);assert.match(await app.text(),/Offline desktop/);
  assert.equal((await fetch(origin+'/missing.js')).status,404);
  const proxy=await fetch(origin+'/proxy-url/'+encodeURIComponent(origin)+'/');assert.equal(proxy.status,200);const html=await proxy.text();assert.match(html,/data-html2svg-capture/);assert.match(html,/selectCaptureDocument/);
  const loadAsset=createExportAssetLoader(origin+'/proxy-url/'+encodeURIComponent(origin)+'/app/index.html');
  const logo=await loadAsset(origin+'/%E5%A2%A8%E5%BD%B1logo.png');assert.equal(logo.kind,'image');assert.equal(logo.source,'data:image/png;base64,iVBORw==');
  const escaped=await fetch(origin+'/missing.js',{headers:{referer:origin+'/proxy-url/'+encodeURIComponent('http://127.0.0.1:34567')+'/'},redirect:'manual'});assert.equal(escaped.status,307);assert.match(escaped.headers.get('location'),/proxy-url/);
  assert.equal((await fetch(origin+'/api/read-local-file?path='+encodeURIComponent(path.join(directory,'index.html')),{headers:{referer:origin+'/proxy-url/example/'}})).status,403);
  if(process.platform==='darwin'){const font=await fetch(origin+'/api/figma-font?weight=400');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/ttf');assert.ok((await font.arrayBuffer()).byteLength>100000);}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});
