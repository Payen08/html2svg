import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { encodeFigmaData, decodeFigmaData } from '@figit/fig-kiwi';
const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('../services/figmaAutoLayoutService.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const defaults = {display:'block',position:'static',flexDirection:'row',flexGrow:'0',alignSelf:'auto',alignItems:'normal',justifyContent:'normal',paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0',rowGap:'normal',columnGap:'normal',order:'0',flexWrap:'nowrap'};
const guid = id => ({sessionID:0,localID:id});
function setup(spaced=false, options={}) {
  const elements = new Map();
  function element(id, tagName, style, width='auto',height='auto') {
    const el = {id,tagName,childNodes:[],namespaceURI:'http://www.w3.org/1999/xhtml',style:{getPropertyValue:()=>''},css:{...defaults,...style},getAttribute:()=>null,computedStyleMap:()=>new Map([['width',width],['height',height]]),domIndex:elements.size,compareDocumentPosition(other){return this.domIndex<other.domIndex?4:2}};
    elements.set(id,el);return el;
  }
  const root=element('body','BODY',{});
  root.ownerDocument={defaultView:{getComputedStyle:el=>el.css}};
  root.querySelector=path=>elements.get(path);
  const row=element('row','DIV',{display:'flex',alignItems:'center',columnGap:'12',paddingLeft:'20',paddingRight:'20'},'100%');
  const button=element('button','BUTTON',{display:'inline-block',paddingLeft:'16',paddingRight:'16',paddingTop:'8',paddingBottom:'8'});
  const content=element('content','DIV',{display:'flex',flexDirection:'column',flexGrow:'1',rowGap:'8'});
  if(options.margins){button.css.marginTop='12px';button.css.marginBottom='8px';button.computedStyleMap=()=>new Map([['width','80px'],['height','40px']]);}
  if(options.maximum)content.css.maxWidth='100px';
  if(options.shrinkable){content.css.flexGrow='0';content.css.flexShrink='1';row.children=[button,content];}
  if(options.captured){button.getAttribute=name=>name==='data-html2svg-sizing-width'?'auto':null;button.computedStyleMap=()=>new Map([['width','100px'],['height','auto']]);}
  if (options.variant === 'inline') { row.css.display = 'block'; content.css.display = 'inline-block'; }
  const nodes=[
    {guid:guid(0),type:'DOCUMENT',name:'Document'},
    {guid:guid(1),type:'CANVAS',name:'Canvas',parentIndex:{guid:guid(0),position:'!'}},
    {guid:guid(2),type:'FRAME',name:'Root',size:{x:600,y:300},parentIndex:{guid:guid(1),position:'!'}},
    ...[[3,'FRAME','body',2],[4,'FRAME','row',3],[5,'FRAME','button',4],[6,'TEXT','label',5],[7,'FRAME','content',4],[8,'TEXT','paragraph',7]].map(([id,type,name,parent])=>({guid:guid(id),type,name,size:{x:100,y:24},visible:true,opacity:1,parentIndex:{guid:guid(parent),position:String(id)},...(type==='TEXT'?{characters:name,textData:{characters:name}}: {})})),
  ];
  const entries=[[3,'body','body'],[4,'row','div'],[5,'button','button'],[6,'button::text[0]','#text'],[7,'content','div'],[8,'content::text[0]','#text']].map(([id,domPath,tag])=>({guid:guid(id),domPath:domPath==='body'?':scope':domPath,tag,kind:tag==='#text'?'text':'frame',rect:{x:0,y:0,width:100,height:24}}));
  if (spaced) entries.find(entry=>entry.guid.localID===7).rect.x=128;
  if(options.margins){nodes.find(n=>n.guid.localID===5).size={x:80,y:40};entries.find(e=>e.guid.localID===5).rect={x:20,y:12,width:80,height:40};}
  if (options.variant === 'border') nodes.push({guid:guid(30),type:'VECTOR',name:'Generated border',size:{x:100,y:24},parentIndex:{guid:guid(5),position:'30'}});
  const result={document:{nodeChanges:nodes,blobs:[]},trace:{rootGuid:guid(2),entries}};
  exports.applyFigmaAutoLayout(root,result);
  const decoded=decodeFigmaData(encodeFigmaData(result.document).figBytes).message.nodeChanges;
  return decoded;
}
test('ordinary button frames become native horizontal Hug stacks, with editable Hug text',()=>{
  const nodes=setup();const button=nodes.find(n=>n.name==='button');const text=nodes.find(n=>n.type==='TEXT'&&n.textData.characters==='label');
  assert.equal(button.stackMode,'HORIZONTAL');
  assert.equal(button.stackPrimarySizing,'RESIZE_TO_FIT');
  assert.equal(button.stackCounterSizing,'RESIZE_TO_FIT');
  assert.equal(button.stackHorizontalPadding,16);assert.equal(button.stackVerticalPadding,8);
  assert.equal(text.textAutoResize,'WIDTH_AND_HEIGHT');assert.equal(text.stackPositioning,'AUTO');
  assert.equal(text.stackChildAlignSelf,'AUTO');
});
test('nested row and column preserve native gap/padding, width fill and flexible siblings after encoding',()=>{
  const nodes=setup();const row=nodes.find(n=>n.name==='row');const content=nodes.find(n=>n.name==='content');
  assert.equal(row.stackMode,'HORIZONTAL');assert.equal(row.stackSpacing,12);assert.equal(row.stackHorizontalPadding,20);
  assert.equal(row.stackChildAlignSelf,'STRETCH');assert.equal(row.stackPrimarySizing,'FIXED');
  assert.equal(content.stackMode,'VERTICAL');assert.equal(content.stackSpacing,8);assert.equal(content.stackChildPrimaryGrow,1);
  assert.equal(content.stackCounterSizing,'FIXED');assert.equal(content.stackPrimarySizing,'RESIZE_TO_FIT');
  assert.ok(nodes.filter(n=>n.type==='FRAME').every(n=>n.stackMode!=='NONE' && n.stackMode));
});

test('unequal spacing becomes padding on a hugging stack instead of absolute child coordinates',()=>{
  const nodes=setup(true);const wrapper=nodes.find(n=>n.name==='Spacing / button');const button=nodes.find(n=>n.name==='button');
  assert.ok(wrapper);assert.equal(wrapper.stackMode,'HORIZONTAL');assert.equal(wrapper.stackPaddingRight,16);
  assert.equal(wrapper.stackPrimarySizing,'RESIZE_TO_FIT');assert.deepEqual(button.parentIndex.guid,wrapper.guid);
  assert.equal(button.stackPositioning,'AUTO');
});
test('paragraph text fills its nested column and grows vertically for wrapping',()=>{
  const paragraph=setup().find(n=>n.type==='TEXT'&&n.textData.characters==='paragraph');
  assert.equal(paragraph.textAutoResize,'HEIGHT');assert.equal(paragraph.stackChildAlignSelf,'STRETCH');
});

test('positive cross-axis margins become native padding around fixed-size content',()=>{
  const nodes=setup(false,{margins:true});const wrapper=nodes.find(n=>n.name==='Margins / button');const button=nodes.find(n=>n.name==='button');
  assert.ok(wrapper);assert.equal(wrapper.stackMode,'HORIZONTAL');
  assert.equal(wrapper.stackVerticalPadding,12);assert.equal(wrapper.stackPaddingBottom,8);
  assert.deepEqual(wrapper.size,{x:80,y:60});assert.deepEqual(button.size,{x:80,y:40});
  assert.deepEqual(button.parentIndex.guid,wrapper.guid);assert.equal(button.stackChildAlignSelf,'AUTO');
});

test('a flex child already at its CSS maximum width cannot grow beyond that width',()=>{
  const content=setup(false,{maximum:true}).find(n=>n.name==='content');
  assert.equal(content.stackChildPrimaryGrow,0);assert.equal(content.size.x,100);
});

test('the captured viewport keeps a fixed height even when the DOM mount has no flow content',()=>{
  const root=setup().find(n=>n.guid.localID===2);
  assert.equal(root.stackPrimarySizing,'FIXED');assert.equal(root.stackCounterSizing,'FIXED');
  assert.deepEqual(root.size,{x:600,y:300});
});

test('generated border vectors stay absolute and do not participate in button Auto Layout',()=>{
  const nodes=setup(false,{variant:'border'});const border=nodes.find(n=>n.name==='Generated border');
  assert.equal(border.stackPositioning,'ABSOLUTE');
  assert.equal(nodes.find(n=>n.name==='button').stackSpacing,0);
});
test('inline siblings in a block become a nested responsive horizontal control row',()=>{
  const nodes=setup(true,{variant:'inline'});const row=nodes.find(n=>n.name==='Inline controls');
  assert.ok(row);assert.equal(row.stackMode,'HORIZONTAL');assert.equal(row.stackWrap,'WRAP');assert.equal(row.stackChildAlignSelf,'STRETCH');
  const button=nodes.find(n=>n.name==='button'),content=nodes.find(n=>n.name==='content');
  assert.deepEqual(button.parentIndex.guid,row.guid);assert.deepEqual(content.parentIndex.guid,row.guid);
  assert.equal(button.stackPositioning,'AUTO');assert.equal(content.stackPositioning,'AUTO');
});

test('captured sizing metadata preserves Hug despite frozen pixel width',()=>{
 const button=setup(false,{captured:true}).find(n=>n.name==='button');assert.equal(button.stackPrimarySizing,'RESIZE_TO_FIT');
});
test('one shrinkable text column beside a fixed control fills remaining width and wraps text',()=>{
 const nodes=setup(false,{shrinkable:true});assert.equal(nodes.find(n=>n.name==='content').stackChildPrimaryGrow,1);assert.equal(nodes.find(n=>n.name==='paragraph').textAutoResize,'HEIGHT');
});

function nestedFullBleed(withSibling=false){
 const elements=new Map();const el=(id,css,width='100%',height='100%')=>{const e={id,tagName:'DIV',namespaceURI:'http://www.w3.org/1999/xhtml',childNodes:[],compareDocumentPosition:()=>4,getAttribute:()=>null,style:{getPropertyValue:()=>''},css:{...defaults,...css},computedStyleMap:()=>new Map([['width',width],['height',height]])};elements.set(id,e);return e};
 const body=el('body',{});body.tagName='BODY';body.ownerDocument={defaultView:{getComputedStyle:e=>e.css}};body.querySelector=p=>elements.get(p);
 el('main',{paddingLeft:'24px',paddingRight:'24px',paddingTop:'24px',paddingBottom:'24px'});el('grid',{});el('bleed',{marginLeft:'-24px',marginRight:'-24px',marginTop:'-24px',marginBottom:'-24px'},'calc(100% + 48px)','calc(100% + 48px)');
 const nodes=[{guid:guid(0),type:'DOCUMENT'},{guid:guid(1),type:'CANVAS',parentIndex:{guid:guid(0),position:'!'}},...[[2,'body',1],[3,'main',2],[4,'grid',3],[5,'bleed',4]].map(([id,name,parent])=>({guid:guid(id),type:'FRAME',name,size:{x:1440,y:900},parentIndex:{guid:guid(parent),position:String(id)}}))];
 const entries=[[2,':scope'],[3,'main'],[4,'grid'],[5,'bleed']].map(([id,domPath])=>({guid:guid(id),tag:'div',domPath,rect:{x:id===4?24:0,y:id===4?24:0,width:id===4?1392:1440,height:id===4?852:900}}));
 if(withSibling){el('sibling',{});nodes.push({guid:guid(6),type:'FRAME',name:'sibling',size:{x:100,y:30},parentIndex:{guid:guid(3),position:'6'}});entries.push({guid:guid(6),tag:'div',domPath:'sibling',rect:{x:24,y:24,width:100,height:30}})}
 const result={document:{nodeChanges:nodes,blobs:[]},trace:{rootGuid:guid(2),entries}};exports.applyFigmaAutoLayout(body,result);return decodeFigmaData(encodeFigmaData(result.document).figBytes).message.nodeChanges;
}
test('full-bleed negative margins cancel page padding through an unpadded single-child shell',()=>{
 const nodes=nestedFullBleed(),main=nodes.find(n=>n.name==='main'),bleed=nodes.find(n=>n.name==='bleed');
 assert.equal(main.stackHorizontalPadding,0);assert.equal(main.stackVerticalPadding,0);assert.equal(main.stackPaddingRight,0);assert.equal(main.stackPaddingBottom,0);
 assert.equal(bleed.stackChildAlignSelf,'STRETCH');assert.equal(bleed.stackChildPrimaryGrow,1);
});
test('nested negative margins never remove padding shared with other page content',()=>{
 const main=nestedFullBleed(true).find(n=>n.name==='main');assert.equal(main.stackHorizontalPadding,24);assert.equal(main.stackVerticalPadding,24);assert.equal(main.stackPaddingRight,24);assert.equal(main.stackPaddingBottom,24);
});
