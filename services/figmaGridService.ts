import type { ConvertResult } from '@figit/dom-to-figma';
const key=(g:{sessionID:number;localID:number})=>`${g.sessionID}:${g.localID}`;
/** CSS Grid columns are shared tracks, never a wrapping flex row. */
export function applyFigmaGridLayout(root:HTMLElement,result:ConvertResult):void {
 const nodes=result.document.nodeChanges;
 let next=Math.max(...nodes.map(n=>n.guid.localID))+1;
 for(const trace of result.trace?.entries||[]){
  if(trace.tag==='#text')continue;
  const element=trace.domPath===':scope'?root:root.querySelector(trace.domPath);
  if(!element||element.namespaceURI==='http://www.w3.org/2000/svg')continue;
  const style=root.ownerDocument.defaultView!.getComputedStyle(element);
  if(!style.display.includes('grid'))continue;
  const node=nodes.find(n=>key(n.guid)===key(trace.guid));if(node?.type!=='FRAME')continue;
  const columns=(style.gridTemplateColumns.match(/[\d.]+px/g)||[]).map(parseFloat);if(!columns.length)continue;
  const children=nodes.filter(n=>n.parentIndex&&key(n.parentIndex.guid)===key(node.guid)&&(n as typeof n & {stackPositioning?:string}).stackPositioning!=='ABSOLUTE');
  if(!children.length)continue;
  const declaration=(element as HTMLElement & {computedStyleMap?:()=>Map<string,unknown>}).computedStyleMap?.().get('grid-template-columns')?.toString()||'';
  const flexible=/fr|auto|min-content|max-content/.test(declaration);
  const guid=()=>({sessionID:node.guid.sessionID,localID:next++});
  const cols=columns.map(guid),rows=Array.from({length:Math.ceil(children.length/columns.length)},guid);
  const positions=(ids:typeof cols)=>({entries:ids.map((id,i)=>({id,position:String(i).padStart(6,'0')}))});
  Object.assign(node,{stackMode:'GRID',stackWrap:'NO_WRAP',stackPrimarySizing:'FIXED',stackCounterSizing:'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
   gridColumns:positions(cols),gridRows:positions(rows),gridAutoTracks:'ROWS',gridReflowEnabled:true,
   gridColumnGap:parseFloat(style.columnGap)||0,gridRowGap:parseFloat(style.rowGap)||0,
   gridColumnsSizing:{entries:cols.map((id,i)=>({id,trackSize:{minSizing:{type:'FIXED',value:flexible?0:columns[i]},maxSizing:{type:flexible?'FLEX':'FIXED',value:columns[i]}}}))},
   gridRowsSizing:{entries:rows.map(id=>({id,trackSize:{minSizing:{type:'HUG',value:1},maxSizing:{type:'HUG',value:1}}}))}});
  children.forEach((child,i)=>{
   Object.assign(child,{gridRowAnchor:rows[Math.floor(i/cols.length)],gridColumnAnchor:cols[i%cols.length],gridRowSpan:1,gridColumnSpan:1,stackChildPrimaryGrow:1,stackChildAlignSelf:'STRETCH'});
   if(child.type==='FRAME'&&child.stackMode==='VERTICAL'){child.stackCounterSizing='FIXED';child.stackPrimarySizing='FIXED';}
  });
 }
}
