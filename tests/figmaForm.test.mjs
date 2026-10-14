import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports={};
runInNewContext(ts.transpileModule(readFileSync(new URL('../services/figmaFormService.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
function element(tagName){
 const attrs=new Map(),props=new Map();return{tagName,children:[],attributes:[],style:{setProperty:(k,v)=>props.set(k,v),getPropertyValue:k=>props.get(k)},setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k)||null,hasAttribute:k=>attrs.has(k),append(child){this.children.push(child)},replaceWith(copy){this.replacement=copy},getBoundingClientRect:()=>({width:16,height:16})};
}
function documentFor(selects=[],inputs=[]){return{defaultView:{getComputedStyle:e=>({length:0,display:'block',appearance:'auto',accentColor:'auto',...e.css})},createElement:element,createElementNS:(_,tag)=>element(tag),querySelectorAll:selector=>selector.startsWith('select')?selects:inputs};}
test('select exports only the current selected label and an editable arrow',()=>{
 const select=element('SELECT');select.selectedOptions=[{textContent:'已选择的机器人'}];select.size=0;
 exports.prepareFigmaFormControls(documentFor([select]));const copy=select.replacement;
 assert.equal(copy.children.length,2);assert.equal(copy.children[0].textContent,'已选择的机器人');assert.equal(copy.children[1].tagName,'svg');assert.match(copy.children[1].innerHTML,/path/);
 assert.equal(copy.style.getPropertyValue('align-items'),'center');assert.equal(copy.style.getPropertyValue('justify-content'),'space-between');
});
test('native checkbox states become visible vector layers; custom painted controls stay intact',()=>{
 const unchecked=element('INPUT'),checked=element('INPUT'),mixed=element('INPUT'),custom=element('INPUT');
 for(const input of [unchecked,checked,mixed,custom]) input.type='checkbox';checked.checked=true;mixed.setAttribute('data-html2svg-indeterminate','');custom.css={appearance:'none'};
 exports.prepareFigmaFormControls(documentFor([],[unchecked,checked,mixed,custom]));
 assert.match(unchecked.replacement.children[0].innerHTML,/<rect/);assert.doesNotMatch(unchecked.replacement.children[0].innerHTML,/<path/);
 assert.match(checked.replacement.children[0].innerHTML,/M4 8L7 11L12 5/);assert.match(mixed.replacement.children[0].innerHTML,/M4 8H12/);assert.equal(custom.replacement,undefined);
 assert.equal(checked.replacement.getAttribute('data-html2svg-sizing-width'),'16px');
});
