import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('desktop-dist',{recursive:true});
await build({entryPoints:['desktop/main.ts'],outfile:'desktop-dist/main.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron'],minify:false});
await copyFile('desktop/preload.cjs','desktop-dist/preload.cjs');
