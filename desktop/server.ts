import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createLocalApiMiddleware } from './localApi';

const mime: Record<string,string> = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json','.woff2':'font/woff2' };
export async function startDesktopServer(uiDirectory: string) {
 const api=createLocalApiMiddleware();
 const server=http.createServer((req,res)=>{
  const origin=`http://${req.headers.host}`;
  const pathname=new URL(req.url||'/',origin).pathname;
  if(pathname.startsWith('/api/')){
   const from=req.headers.referer;
   const requestOrigin=req.headers.origin;
   if(requestOrigin&&requestOrigin!==origin||from&&new URL(from).pathname.startsWith('/proxy')){res.writeHead(403);res.end('This API belongs to the desktop application.');return;}
  }
  const serve=()=>{
   if(!['GET','HEAD'].includes(req.method||'GET')){res.writeHead(405);res.end();return;}
   let file:string;
   try{file=path.resolve(uiDirectory,'.'+decodeURIComponent(pathname));}catch{res.writeHead(400);res.end();return;}
   if(file!==uiDirectory&&!file.startsWith(uiDirectory+path.sep)){res.writeHead(403);res.end();return;}
   if(pathname==='/')file=path.join(uiDirectory,'index.html');
   try{const stat=fs.statSync(file);if(!stat.isFile())throw Error('Not a file');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end('Not found');}
  };
  Promise.resolve(api(req,res,serve)).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Local service error');});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();if(!address||typeof address==='string')throw Error('No local server address');
 return { server, origin:`http://127.0.0.1:${address.port}` };
}
