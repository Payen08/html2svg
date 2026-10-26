import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {encodeFigmaData} from '@figit/fig-kiwi';
const compile=file=>ts.transpileModule(readFileSync(new URL('../services/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const preserve={};runInNewContext(compile('figmaPreserveLayoutService.ts'),{exports:preserve});
const exports={};runInNewContext(compile('figmaLayoutSafetyService.ts'),{exports,require:()=>preserve,structuredClone});
const guid=id=>({sessionID:0,localID:id});
function fixture(css={}){
 const defaults={display:'flex',position:'static',transform:'none',columnCount:'auto',columnWidth:'auto',writingMode:'horizontal-tb',direction:'ltr',flexDirection:'row',flexWrap:'nowrap',justifyContent:'normal',cssFloat:'none'};
 const elements=new Map();const el=(id,style={})=>{const e={id,tagName:'DIV',namespaceURI:'http://www.w3.org/1999/xhtml',children:[],parentElement:null,css:{...defaults,...style}};elements.set(id,e);return e};
 const root=el('root'),complex=el('complex',css),button=el('button'),safe=el('safe'),text=el('text');complex.children=[button];button.children=[text];button.parentElement=complex;text.parentElement=button;complex.parentElement=root;safe.parentElement=root;root.children=[complex,safe];
 root.ownerDocument={defaultView:{getComputedStyle:e=>e.css}};root.querySelector=p=>elements.get(p);
 const ns=[{guid:guid(0),type:'DOCUMENT'},{guid:guid(1),type:'CANVAS',parentIndex:{guid:guid(0),position:'1'}},...[['root',2,1],['complex',3,2],['button',4,3],['safe',5,2]].map(([name,id,parent])=>({guid:guid(id),type:'FRAME',name,size:{x:200,y:100},transform:{m00:1,m01:0,m02:0,m10:0,m11:1,m12:0},parentIndex:{guid:guid(parent),position:String(id)},stackMode:'HORIZONTAL',stackPrimarySizing:'RESIZE_TO_FIT',stackCounterSizing:'RESIZE_TO_FIT',stackPositioning:'AUTO'})),{guid:guid(6),type:'TEXT',name:'text',characters:'可编辑文字',fontSize:16,textAutoResize:'WIDTH_AND_HEIGHT',size:{x:100,y:20},transform:{m00:1,m01:0,m02:0,m10:0,m11:1,m12:0},parentIndex:{guid:guid(4),position:'6'}}];
 const result={document:{nodeChanges:ns,blobs:[]},trace:{rootGuid:guid(2),entries:[['root',2],['complex',3],['button',4],['safe',5],['text',6]].map(([domPath,id])=>({guid:guid(id),domPath:domPath==='root'?':scope':domPath,tag:id===6?'span':'div',rect:{x:id===4||id===6?10:0,y:id===4||id===6?12:0,width:200,height:100}}))}};
 return{root,result,ns,complex,button,safe,baseline:exports.captureFigmaLayoutBaseline(result)};
}
test('ordinary flex layouts stay native and the baseline is independent of mutations',()=>{
 const f=fixture();f.ns.find(n=>n.name==='button').size.x=999;assert.equal(f.baseline.get('0:4').size.x,200);
 const report=exports.applyFigmaLayoutSafety(f.root,f.result,f.baseline);assert.equal(report.preserved.length,0);assert.equal(f.result.document.nodeChanges.find(n=>n.name==='complex').stackMode,'HORIZONTAL');exports.validateFigmaLayout(f.result);encodeFigmaData(f.result.document);
});
test('unsupported local spacing preserves measured children while safe components and siblings keep Auto Layout',()=>{
 const f=fixture({justifyContent:'space-evenly'});const button=f.ns.find(n=>n.name==='button');button.transform.m02=400;
 f.ns.push({guid:guid(20),type:'FRAME',name:'Generated spacing',parentIndex:{guid:guid(3),position:'4'}});button.parentIndex.guid=guid(20);
 const report=exports.applyFigmaLayoutSafety(f.root,f.result,f.baseline);const ns=f.result.document.nodeChanges;
 assert.equal(report.preserved[0].scope,'container');assert.equal(ns.find(n=>n.name==='complex').stackMode,'NONE');assert.equal(ns.find(n=>n.name==='button').stackMode,'HORIZONTAL');assert.equal(ns.find(n=>n.name==='safe').stackMode,'HORIZONTAL');assert.equal(button.transform.m02,10);assert.equal(button.transform.m12,12);assert.equal(button.parentIndex.guid.localID,3);assert.ok(!ns.some(n=>n.guid.localID===20));exports.validateFigmaLayout(f.result);encodeFigmaData(f.result.document);
});
test('scaled subtrees preserve their geometry and scale editable text metrics only inside that subtree',()=>{
 const f=fixture({transform:'matrix(2, 0, 0, 2, 0, 0)'});const report=exports.applyFigmaLayoutSafety(f.root,f.result,f.baseline);const ns=f.result.document.nodeChanges;
 assert.equal(report.preserved.length,1);assert.equal(report.preserved[0].scope,'subtree');assert.equal(ns.find(n=>n.name==='button').stackMode,'NONE');assert.equal(ns.find(n=>n.name==='safe').stackMode,'HORIZONTAL');assert.equal(ns.find(n=>n.type==='TEXT').fontSize,32);assert.equal(ns.find(n=>n.type==='TEXT').characters,'可编辑文字');exports.validateFigmaLayout(f.result);encodeFigmaData(f.result.document);
});
test('named grids and reverse flex are explicitly preserved instead of reinterpreted',()=>{
 for(const css of [{display:'grid',gridTemplateAreas:'"a a" "b c"',gridTemplateColumns:'100px 100px'},{flexDirection:'row-reverse'}]){const f=fixture(css);const report=exports.applyFigmaLayoutSafety(f.root,f.result,f.baseline);assert.equal(report.preserved.length,1);assert.equal(f.result.document.nodeChanges.find(n=>n.name==='complex').stackMode,'NONE')}
});
test('the final invariant pass repairs empty Hug containing blocks',()=>{
 const f=fixture();f.ns.find(n=>n.name==='button').stackPositioning='ABSOLUTE';const report=exports.applyFigmaLayoutSafety(f.root,f.result,f.baseline);assert.ok(report.repaired>0);assert.equal(f.ns.find(n=>n.name==='complex').stackPrimarySizing,'FIXED');
});
test('structural validation rejects orphaned parents, cycles, non-finite geometry and broken grid anchors',()=>{
 let f=fixture();f.ns.find(n=>n.name==='button').parentIndex.guid=guid(999);assert.throws(()=>exports.validateFigmaLayout(f.result),/父容器缺失/);
 f=fixture();f.ns.find(n=>n.name==='complex').parentIndex.guid=guid(4);assert.throws(()=>exports.validateFigmaLayout(f.result),/层级循环/);
 f=fixture();f.ns.find(n=>n.name==='button').size.x=NaN;assert.throws(()=>exports.validateFigmaLayout(f.result),/尺寸无效/);
 f=fixture();Object.assign(f.ns.find(n=>n.name==='complex'),{stackMode:'GRID',gridRows:{entries:[]},gridColumns:{entries:[]}});assert.throws(()=>exports.validateFigmaLayout(f.result),/网格列或行缺失/);
});

test('a body with only fixed overlays keeps the viewport instead of zero height',()=>{
 const f=fixture();f.root.tagName='BODY';f.root.ownerDocument.documentElement={clientWidth:1000,clientHeight:700};f.result.trace.entries[0].rect.height=0;f.ns.find(n=>n.name==='complex').stackPositioning='ABSOLUTE';f.ns.find(n=>n.name==='safe').stackPositioning='ABSOLUTE';exports.applyFigmaLayoutSafety(f.root,f.result,f.baseline);assert.equal(f.ns.find(n=>n.name==='root').size.y,700);
});
