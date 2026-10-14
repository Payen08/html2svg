import {Resvg} from '@resvg/resvg-js';
import {readFileSync,writeFileSync} from 'node:fs';
const png=readFileSync('assets/logo.png').toString('base64');
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 450 450"><image href="data:image/png;base64,${png}" width="450" height="450"/></svg>`);
const chunks=[];
for(const [type,size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]]){
 const png=new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
 const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(png.length+8,4);chunks.push(header,png);
}
const body=Buffer.concat(chunks),header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(body.length+8,4);
writeFileSync('desktop/assets/icon.icns',Buffer.concat([header,body]));
