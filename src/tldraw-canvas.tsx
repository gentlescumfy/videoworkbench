import { useEffect, useId, useRef, type MutableRefObject } from 'react';
import { BaseBoxShapeUtil, DefaultMinimap, HTMLContainer, T, Tldraw, createShapeId, useEditor, useValue, type Editor, type TLBaseShape, type TLGridProps, type TLUiOverrides } from 'tldraw';
import { Maximize2, Minus, Plus } from 'lucide-react';
import 'tldraw/tldraw.css';
import type { CanvasNode, CanvasEdge } from './types';
import { ProductionNode, type ProductionCanvasNode, type ProductionNodeData } from './production';

type WorkbenchShape = TLBaseShape<'workbench', { w:number; h:number; nodeId:string; nodeType:string; data:string }>;
type WorkbenchEdgeShape = TLBaseShape<'workbench-edge', { w:number; h:number; sx:number; sy:number; tx:number; ty:number }>;
declare module 'tldraw' { export interface TLGlobalShapePropsMap { workbench: WorkbenchShape['props']; 'workbench-edge': WorkbenchEdgeShape['props'] } }
export type DisplayNode = CanvasNode | ProductionCanvasNode;
type Callbacks = { select:(id:string)=>void; pane:()=>void; position:(id:string,x:number,y:number)=>void; delete:(id:string)=>void; duplicate:(id:string)=>void; studio:(id:string,data:CanvasNode['data'])=>React.ReactNode };
let callbacks:Callbacks = {select:()=>{},pane:()=>{},position:()=>{},delete:()=>{},duplicate:()=>{},studio:()=>null};
const overrides:TLUiOverrides={
 actions(editor,actions){
  // The project owns undo/redo so card data and edges restore together.
  delete actions.undo;delete actions.redo;
  actions.duplicate={...actions.duplicate,onSelect:()=>{for(const shape of editor.getSelectedShapes()){if(shape.type==='workbench'&&shape.props.nodeType==='studio')callbacks.duplicate(shape.props.nodeId);}}};
  return actions;
 },
 tools(_editor,tools){return Object.fromEntries(Object.entries(tools).filter(([id])=>id==='select'||id==='hand'));},
};
class WorkbenchShapeUtil extends BaseBoxShapeUtil<WorkbenchShape> {
 static override type='workbench' as const;
 static override props={w:T.number,h:T.number,nodeId:T.string,nodeType:T.string,data:T.string};
 override getDefaultProps(){return {w:245,h:220,nodeId:'',nodeType:'studio',data:'{}'};}
 override canResize(){return false;}
 override component(shape:WorkbenchShape){
  const data=JSON.parse(shape.props.data);
  return <HTMLContainer className="workbench-shape" style={{width:shape.props.w,height:shape.props.h}} onClick={e=>{if(!shape.isLocked&&!(e.target as HTMLElement).closest('button,a,input,video,audio'))callbacks.select(shape.props.nodeId);}} onPointerDownCapture={e=>{if((e.target as HTMLElement).closest('button,a,input,video,audio,textarea,select'))e.stopPropagation();}}>
   {shape.props.nodeType==='production'?<ProductionNode data={data as ProductionNodeData}/>:callbacks.studio(shape.props.nodeId,data as CanvasNode['data'])}
  </HTMLContainer>;
 }
 override getIndicatorPath(shape:WorkbenchShape){const path=new Path2D();path.rect(0,0,shape.props.w,shape.props.h);return path;}
}
class WorkbenchEdgeShapeUtil extends BaseBoxShapeUtil<WorkbenchEdgeShape> {
 static override type='workbench-edge' as const;
 static override props={w:T.number,h:T.number,sx:T.number,sy:T.number,tx:T.number,ty:T.number};
 override getDefaultProps(){return {w:1,h:1,sx:0,sy:0,tx:1,ty:1};}
 override component(shape:WorkbenchEdgeShape){return <HTMLContainer style={{width:shape.props.w,height:shape.props.h,pointerEvents:'none'}}><svg width={shape.props.w} height={shape.props.h} style={{overflow:'visible'}}><path d={`M${shape.props.sx} ${shape.props.sy} L${shape.props.tx} ${shape.props.ty}`} stroke="#8e6680" strokeWidth="2" fill="none"/><circle cx={shape.props.tx} cy={shape.props.ty} r="4" fill="#bd85a5"/></svg></HTMLContainer>;}
 override getIndicatorPath(shape:WorkbenchEdgeShape){const path=new Path2D();path.rect(0,0,shape.props.w,shape.props.h);return path;}
}
const shapeUtils=[WorkbenchShapeUtil,WorkbenchEdgeShapeUtil];
function CanvasGrid({x,y,z}:TLGridProps){
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 const step=20*z*(z<.25?4:1);
 return <svg className="tl-grid" aria-hidden="true"><defs><pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse" x={x*z%step} y={y*z%step}><circle cx={step/2} cy={step/2} r={1} fill="rgba(255,255,255,.28)"/></pattern></defs><rect width="100%" height="100%" fill={`url(#${id})`}/></svg>;
}
const canvasComponents={Grid:CanvasGrid};
const shapeId=(id:string)=>createShapeId(id);
const box=(node:DisplayNode)=>({x:node.position.x,y:node.position.y,w:'width' in node?node.width:node.data.kind==='图片'||node.data.kind==='视频'||node.data.kind==='音频'?420:245,h:'height' in node?node.height:node.data.kind==='图片'||node.data.kind==='视频'?410:220});
const edgeRecord=(edge:CanvasEdge,nodes:DisplayNode[])=>{const source=nodes.find(n=>n.id===edge.source);const target=nodes.find(n=>n.id===edge.target);if(!source||!target)return null;const a=box(source),b=box(target);const sx=a.x+a.w/2,sy=a.y+a.h,tx=b.x+b.w/2,ty=b.y;const x=Math.min(sx,tx),y=Math.min(sy,ty);return {id:shapeId(`edge-${edge.id}`),type:'workbench-edge' as const,x,y,isLocked:true,props:{w:Math.max(1,Math.abs(tx-sx)),h:Math.max(1,Math.abs(ty-sy)),sx:sx-x,sy:sy-y,tx:tx-x,ty:ty-y}};};
function CanvasNavigation({nodes,minimap}:{nodes:DisplayNode[];minimap:boolean}){
 const editor=useEditor();const zoom=useValue('camera zoom',()=>Math.round(editor.getZoomLevel()*100),[editor]);
 return <>
  {minimap&&<div className="workbench-minimap"><DefaultMinimap/></div>}
  <div className="canvas-navigation" onPointerDown={e=>e.stopPropagation()}>
   <button aria-label="缩小画布" title="缩小画布" onClick={()=>editor.zoomOut()}><Minus size={16}/></button>
   <button aria-label="重置缩放" title="重置为 100%" onClick={()=>editor.resetZoom()}>{zoom}%</button>
   <button aria-label="放大画布" title="放大画布" onClick={()=>editor.zoomIn()}><Plus size={16}/></button>
   <button aria-label="适应全部内容" title="适应全部内容" onClick={()=>canvasFit(editor,nodes)}><Maximize2 size={16}/></button>
  </div>
 </>;
}
export function TldrawCanvas({nodes,edges,editorRef,onSelect,onPane,onPosition,onDelete,onDuplicate,onCheckpoint,renderStudio,onDrop,pan,minimap}:{nodes:DisplayNode[];edges:CanvasEdge[];editorRef:MutableRefObject<Editor|null>;onSelect:(id:string)=>void;onPane:()=>void;onPosition:(id:string,x:number,y:number)=>void;onDelete:(id:string)=>void;onDuplicate:(id:string)=>void;onCheckpoint:()=>void;renderStudio:(id:string,data:CanvasNode['data'])=>React.ReactNode;onDrop:(files:File[],point:{x:number;y:number})=>void;pan:boolean;minimap:boolean}){
 const syncing=useRef(false);
 const focused=useRef('');
 callbacks={select:onSelect,pane:onPane,position:onPosition,delete:onDelete,duplicate:onDuplicate,studio:renderStudio};
 useEffect(()=>{const editor=editorRef.current;if(editor)editor.setCurrentTool(pan?'hand':'select');},[editorRef,pan]);
 useEffect(()=>{
  const editor=editorRef.current;if(!editor)return;
  const wanted=new Set(nodes.map(n=>shapeId(n.id)));
  const existing=editor.getCurrentPageShapes().filter(s=>s.type==='workbench');
  syncing.current=true;
  try{editor.store.mergeRemoteChanges(()=>{editor.run(()=>{
   const removed=existing.filter(s=>!wanted.has(s.id)).map(s=>s.id);
   if(removed.length)editor.deleteShapes(removed);
   const current=new Map(editor.getCurrentPageShapes().filter(s=>s.type==='workbench').map(s=>[s.id,s]));
   for(const node of nodes){
    const id=shapeId(node.id);const bounds=box(node);const props={w:bounds.w,h:bounds.h,nodeId:node.id,nodeType:node.type==='production'?'production':'studio',data:JSON.stringify(node.data)};
    const old=current.get(id) as WorkbenchShape|undefined;
    const isLocked='draggable' in node&&node.draggable===false;
    if(!old)editor.createShape({id,type:'workbench',x:bounds.x,y:bounds.y,isLocked,props});
    else if(old.x!==bounds.x||old.y!==bounds.y||old.isLocked!==isLocked||JSON.stringify(old.props)!==JSON.stringify(props))editor.updateShape({id,type:'workbench',x:bounds.x,y:bounds.y,isLocked,props});
   }
   const desiredEdges=edges.map(edge=>edgeRecord(edge,nodes)).filter((value):value is NonNullable<typeof value>=>Boolean(value));
   const edgeIds=new Set(desiredEdges.map(edge=>edge.id));
   const currentEdges=new Map(editor.getCurrentPageShapes().filter(s=>s.type==='workbench-edge').map(s=>[s.id,s]));
   const oldEdges=[...currentEdges.keys()].filter(id=>!edgeIds.has(id));if(oldEdges.length)editor.deleteShapes(oldEdges);
   for(const edge of desiredEdges){const old=currentEdges.get(edge.id) as WorkbenchEdgeShape|undefined;if(!old)editor.createShape(edge);else if(old.x!==edge.x||old.y!==edge.y||JSON.stringify(old.props)!==JSON.stringify(edge.props))editor.updateShape(edge);}
  },{ignoreShapeLock:true});});}finally{syncing.current=false;}
  const focusKind=nodes.some(n=>n.type==='production')?'production':'studio';
  if(nodes.length&&focused.current!==focusKind){
   const initial=nodes.find(n=>n.type==='production'&&n.data.kind==='分镜'&&(n.data as ProductionNodeData).item&&!(n.data as ProductionNodeData).item?.videoUrl)||nodes.find(n=>n.type==='production'&&n.data.kind==='剧本')||nodes[0];
   const b=box(initial);editor.zoomToBounds({x:b.x,y:b.y,w:b.w,h:b.h},{inset:150,targetZoom:focusKind==='production'?.72:1});focused.current=focusKind;
  }
 },[nodes,edges,editorRef]);
 return <div className="workbench-tldraw" onPointerDownCapture={e=>{const target=e.target as HTMLElement;if(target.closest('.tl-shape')&&!target.closest('button,a,input,textarea,video,audio'))onCheckpoint();}} onClick={e=>{if(!(e.target as HTMLElement).closest('.tl-shape'))callbacks.pane();}} onDrop={e=>{e.preventDefault();onDrop(Array.from(e.dataTransfer.files),{x:e.clientX,y:e.clientY});}} onDragOver={e=>e.preventDefault()}>
  <Tldraw hideUi colorScheme="dark" components={canvasComponents} overrides={overrides} licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} shapeUtils={shapeUtils} onMount={editor=>{
   editorRef.current=editor;
   editor.updateInstanceState({isGridMode:true});
   editor.setCurrentTool(pan?'hand':'select');
   editor.sideEffects.registerBeforeDeleteHandler('shape',shape=>{if(!syncing.current&&shape.type==='workbench'&&shape.props.nodeType==='production')return false;});
   editor.sideEffects.registerAfterDeleteHandler('shape',(shape,source)=>{if(!syncing.current&&source==='user'&&shape.type==='workbench'&&shape.props.nodeType==='studio')callbacks.delete(shape.props.nodeId);});
   const edgeShapes=edges.map(edge=>edgeRecord(edge,nodes)).filter((value):value is NonNullable<typeof value>=>Boolean(value));
   if(edgeShapes.length)editor.createShapes(edgeShapes);
   const pending=nodes.map(node=>{const b=box(node);return {id:shapeId(node.id),type:'workbench' as const,x:b.x,y:b.y,isLocked:'draggable' in node&&node.draggable===false,props:{w:b.w,h:b.h,nodeId:node.id,nodeType:node.type==='production'?'production':'studio',data:JSON.stringify(node.data)}};});
   editor.createShapes(pending);
   editor.sideEffects.registerAfterCreateHandler('shape',(shape,source)=>{if(!syncing.current&&source==='user'){syncing.current=true;try{editor.deleteShapes([shape.id]);}finally{syncing.current=false;}}});
   if(pending.length){const focusKind=nodes.some(n=>n.type==='production')?'production':'studio';const initial=nodes.find(n=>n.type==='production'&&n.data.kind==='分镜'&&(n.data as ProductionNodeData).item&&!(n.data as ProductionNodeData).item?.videoUrl)||nodes.find(n=>n.type==='production'&&n.data.kind==='剧本')||nodes[0];const b=box(initial);editor.zoomToBounds({x:b.x,y:b.y,w:b.w,h:b.h},{inset:150,targetZoom:focusKind==='production'?.72:1});focused.current=focusKind;}
   editor.store.listen(({changes})=>{
    if(syncing.current)return;
    for(const [id,update] of Object.entries(changes.updated)){
     const next=update[1] as WorkbenchShape;
     if(!id.startsWith('shape:')||next?.type!=='workbench')continue;
     const prev=update[0] as WorkbenchShape;
     if(next.x!==prev.x||next.y!==prev.y)callbacks.position(next.props.nodeId,next.x,next.y);
    }
   },{source:'user',scope:'document'});
  }}><CanvasNavigation nodes={nodes} minimap={minimap}/></Tldraw>
 </div>;
}
export function canvasFit(editor:Editor|null,nodes:DisplayNode[],padding=.25){if(!editor||!nodes.length)return;const bounds=nodes.map(box);const left=Math.min(...bounds.map(b=>b.x));const top=Math.min(...bounds.map(b=>b.y));const right=Math.max(...bounds.map(b=>b.x+b.w));const bottom=Math.max(...bounds.map(b=>b.y+b.h));editor.zoomToBounds({x:left,y:top,w:right-left,h:bottom-top},{inset:Math.max(40,Math.min(180,padding*400)),animation:{duration:400}});}
