import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {encodeFigmaData,decodeFigmaData} from '@figit/fig-kiwi';
const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../services/figmaGridService.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('two fractional CSS grid maps share native tracks and stay Fill rather than wrapping fixed cards',()=>{
 const guid=id=>({sessionID:0,localID:id});
 const element={namespaceURI:'http://www.w3.org/1999/xhtml',computedStyleMap:()=>new Map([['grid-template-columns','minmax(0px, 1fr) minmax(0px, 1fr)']])};
 const root={querySelector:()=>element,ownerDocument:{defaultView:{getComputedStyle:()=>({display:'grid',gridTemplateColumns:'836px 836px',columnGap:'16px',rowGap:'16px'})}}};
 const nodes=[{guid:guid(0),type:'DOCUMENT'},{guid:guid(1),type:'CANVAS',parentIndex:{guid:guid(0),position:'!'}},{guid:guid(2),type:'FRAME',name:'Maps',size:{x:1688,y:504},parentIndex:{guid:guid(1),position:'!'}},...[3,4].map(id=>({guid:guid(id),type:'FRAME',name:'Map',stackMode:'VERTICAL',parentIndex:{guid:guid(2),position:String(id)}}))];
 const result={document:{nodeChanges:nodes,blobs:[]},trace:{entries:[{guid:guid(2),tag:'div',domPath:'.maps'}]}};exports.applyFigmaGridLayout(root,result);
 const ns=decodeFigmaData(encodeFigmaData(result.document).figBytes).message.nodeChanges;const grid=ns.find(n=>n.name==='Maps');
 assert.equal(grid.stackMode,'GRID');assert.equal(grid.stackWrap,'NO_WRAP');assert.equal(grid.gridColumnGap,16);assert.equal(grid.gridColumns.entries.length,2);
 assert.ok(grid.gridColumnsSizing.entries.every(e=>e.trackSize.maxSizing.type==='FLEX'));assert.equal(grid.gridRowsSizing.entries[0].trackSize.maxSizing.type,'HUG');
 const maps=ns.filter(n=>n.name==='Map');assert.deepEqual(maps[0].gridRowAnchor,maps[1].gridRowAnchor);assert.notDeepEqual(maps[0].gridColumnAnchor,maps[1].gridColumnAnchor);assert.ok(maps.every(n=>n.stackChildPrimaryGrow===1&&n.stackChildAlignSelf==='STRETCH'));
});

test('a centered 50px SVG stays fixed inside a 90px icon container after encoding',()=>{
 const guid=id=>({sessionID:0,localID:id});
 const cell={namespaceURI:'http://www.w3.org/1999/xhtml',computedStyleMap:()=>new Map([['width','90px'],['height','90px']]),css:{display:'grid',gridTemplateColumns:'90px',justifyItems:'center',alignItems:'center',columnGap:'0',rowGap:'0'}};
 const icon={namespaceURI:'http://www.w3.org/2000/svg',computedStyleMap:()=>new Map([['width','50px'],['height','50px']]),css:{display:'block',justifySelf:'auto',alignSelf:'auto'}};
 const root={querySelector:p=>p==='.icon'?icon:cell,ownerDocument:{defaultView:{getComputedStyle:e=>e.css}}};
 const nodes=[{guid:guid(2),type:'FRAME',name:'Icon container',size:{x:90,y:90},stackMode:'VERTICAL'}, {guid:guid(3),type:'FRAME',name:'SVG',size:{x:50,y:50},stackMode:'NONE',stackChildPrimaryGrow:1,stackChildAlignSelf:'STRETCH',parentIndex:{guid:guid(2),position:'0'}}];
 const result={document:{nodeChanges:nodes,blobs:[]},trace:{entries:[{guid:guid(2),tag:'span',domPath:'.cell'},{guid:guid(3),tag:'svg',domPath:'.icon'}]}};
 exports.applyFigmaGridLayout(root,result);
 const decoded=decodeFigmaData(encodeFigmaData(result.document).figBytes).message.nodeChanges;const box=decoded[0],svg=decoded[1];
 assert.equal(box.stackMode,'HORIZONTAL');assert.equal(box.stackPrimarySizing,'FIXED');assert.equal(box.stackCounterSizing,'FIXED');
 assert.equal(box.stackPrimaryAlignItems,'CENTER');assert.equal(box.stackCounterAlignItems,'CENTER');
 assert.deepEqual(svg.size,{x:50,y:50});assert.equal(svg.stackChildPrimaryGrow,0);assert.equal(svg.stackChildAlignSelf,'AUTO');
});

function spanGrid(items,rows='none',height='auto'){
 const guid=id=>({sessionID:0,localID:id});const grid={namespaceURI:'http://www.w3.org/1999/xhtml',computedStyleMap:()=>new Map([['grid-template-columns','repeat(12, minmax(0px, 1fr))'],['grid-template-rows',rows],['height',height]]),css:{display:'grid',gridTemplateColumns:Array(12).fill('100px').join(' '),alignItems:'normal',justifyItems:'normal',columnGap:'12px',rowGap:'12px'}};
 const elements=new Map([['.grid',grid],...items.map((css,i)=>['.item'+i,{namespaceURI:grid.namespaceURI,css:{display:'block',...css},computedStyleMap:()=>new Map()}])]);
 const root={querySelector:p=>elements.get(p),ownerDocument:{defaultView:{getComputedStyle:e=>e.css}}};
 const nodes=[{guid:guid(2),type:'FRAME',name:'Grid',size:{x:1332,y:600}},...items.map((_,i)=>({guid:guid(3+i),type:'FRAME',name:'Item '+i,stackMode:'VERTICAL',parentIndex:{guid:guid(2),position:String(i)}}))];
 const result={document:{nodeChanges:nodes,blobs:[]},trace:{entries:[{guid:guid(2),tag:'div',domPath:'.grid'},...items.map((_,i)=>({guid:guid(3+i),tag:'div',domPath:'.item'+i}))]}};exports.applyFigmaGridLayout(root,result);return decodeFigmaData(encodeFigmaData(result.document).figBytes).message.nodeChanges;
}
test('a 12-track dashboard retains 7/5 column spans and one shared row',()=>{
 const [grid,left,right]=spanGrid([{gridColumnStart:'span 7',gridColumnEnd:'span 7'},{gridColumnStart:'span 5',gridColumnEnd:'span 5'}]);
 assert.equal(left.gridColumnSpan,7);assert.equal(right.gridColumnSpan,5);assert.deepEqual(left.gridRowAnchor,right.gridRowAnchor);
 assert.deepEqual(left.gridColumnAnchor,grid.gridColumns.entries[0].id);assert.deepEqual(right.gridColumnAnchor,grid.gridColumns.entries[7].id);assert.equal(grid.gridRows.entries.length,1);
 assert.equal(left.stackChildPrimaryGrow,1);assert.equal(right.stackChildPrimaryGrow,1);
});
test('explicit placement and multi-row spans reserve occupied cells for automatic siblings',()=>{
 const [grid,first,next]=spanGrid([{gridColumnStart:'2',gridColumnEnd:'5',gridRowStart:'1',gridRowEnd:'span 2'},{gridColumnStart:'span 10',gridColumnEnd:'auto'}]);
 assert.equal(first.gridColumnSpan,3);assert.equal(first.gridRowSpan,2);assert.deepEqual(first.gridColumnAnchor,grid.gridColumns.entries[1].id);assert.deepEqual(next.gridRowAnchor,grid.gridRows.entries[2].id);
});
test('fractional CSS rows fill fixed-height dashboard space rather than shrinking to text',()=>{
 const [grid]=spanGrid([{gridColumnStart:'span 12'}],'minmax(0px, 1fr)','100%');assert.equal(grid.gridRowsSizing.entries[0].trackSize.maxSizing.type,'FLEX');assert.equal(grid.stackCounterSizing,'FIXED');
});
