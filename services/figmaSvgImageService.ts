import { createExportAssetLoader } from './exportAssetService';
/** The native vector converter omits SVG <image>. Preserve bitmap-bearing map SVGs as images. */
export async function preserveSvgImageLayers(doc:Document):Promise<void>{
 const load=createExportAssetLoader();
 const svgs=Array.from(doc.querySelectorAll('svg')).filter(svg=>svg.querySelector('image')&&!svg.parentElement?.closest('svg'));
 for(const svg of svgs){
  const clone=svg.cloneNode(true) as SVGSVGElement;
  const originalImages=Array.from(svg.querySelectorAll('image'));
  await Promise.all(Array.from(clone.querySelectorAll('image')).map(async(image,i)=>{
   const raw=originalImages[i].getAttribute('href')||originalImages[i].getAttributeNS('http://www.w3.org/1999/xlink','href');
   if(!raw)return;
   const asset=await load(new URL(raw,doc.baseURI).href);
   const href=asset.kind==='image'?asset.source:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(asset.source);
   image.removeAttributeNS('http://www.w3.org/1999/xlink','href');image.setAttribute('href',href);
  }));
  // Inline computed presentation so external CSS remains visible inside the isolated SVG image.
  const originals=[svg,...Array.from(svg.querySelectorAll('*'))],copies=[clone,...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((el,i)=>{const style=doc.defaultView!.getComputedStyle(el);for(const prop of ['fill','stroke','stroke-width','opacity','filter','font-family','font-size','font-weight'])(copies[i] as SVGElement).style.setProperty(prop,style.getPropertyValue(prop));});
  const rect=svg.getBoundingClientRect();clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(rect.width));clone.setAttribute('height',String(rect.height));
  const image=doc.createElement('img');image.setAttribute('data-figma-name','Map / embedded SVG image');image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const style=doc.defaultView!.getComputedStyle(svg);
  for(const prop of ['width','height','display','position','top','left','right','bottom','margin','flex-grow','flex-shrink','align-self','opacity'])image.style.setProperty(prop,style.getPropertyValue(prop));
  svg.replaceWith(image);await image.decode();
 }
}
