import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, Clapperboard, Eye, FileText, Film, Image, Languages, LoaderCircle, Maximize2, Pencil, RefreshCw, RotateCcw, SlidersHorizontal, Square, Volume2, Upload, X } from 'lucide-react';
import { api, post, ApiError } from './api';
import { IconButton, Modal, type ComposerValue } from './components';
import { useStudio } from './studio';
import type { AgentDataSource } from './types';
import { parseNumberList, parseShotNumbers } from '../shared/shot-numbers.mjs';
import './production.css';

export type ProductionItem = {
 id:string;name?:string;title?:string;number?:number;description:string;imagePrompt:string;
 imageUrl?:string;videoUrl?:string;audioUrl?:string;videoPrompt?:string;audioPrompt?:string;dialogue?:string;
 turnaroundUrl?:string;turnaroundPrompt?:string;expressionUrl?:string;expressionPrompt?:string;
 multiviewUrl?:string;multiviewPrompt?:string;
 characterIds?:string[];sceneId?:string;duration?:number;
 imageSlots?:string[];
 assetSettings?:Record<string,{ratio?:string;resolution?:string;model?:string;modelExplicit?:boolean;style?:string;quality?:string;transparent?:boolean}>;
 assetReferences?:Record<string,string[]>;
};
export type ProductionAssetSlot = {
 id:string;slot:string;label:string;kind:'image'|'video'|'audio';url?:string;prompt?:string;
};
type Task = {id:string;runId:string;stage:string;agent:string;title:string;kind:string;model:string;status:string;error?:string;createdAt:string;startedAt?:string;finishedAt?:string;target?:{id:string;slot:string;number?:number};outputUrl?:string};
export type Production = {
 id:string;version:number;stage:string;status:string;brief:string;title:string;script:string;
 characters:ProductionItem[];scenes:ProductionItem[];shots:ProductionItem[];tasks:Task[];
 events:{id:string;role:string;text:string;stage:string;agent:string;createdAt:string}[];
 settings:{models?:Record<string,string>;style?:string;ratio?:string;duration?:number;separateShotAudio?:boolean;confirmation?:{image:boolean;audio:boolean;video:boolean;cooldown:boolean;threshold:number}};
 musicUrl:string;outputUrl:string;skipped:string[];runId?:string;
};
type Stage = {id:string;title:string;agent:string;kind:string};
type Command = {action:string;prompt?:string;mode?:'one'|'all';targetIds?:string[];targetNumbers?:number[];targetId?:string;changes?:Record<string,string>;assetSlot?:string;assetUrl?:string;assetSettings?:NonNullable<ProductionItem['assetSettings']>[string];assetReferences?:string[];settings?:unknown};
const statusLabels:Record<string,string>={pending:'待生成',queued:'排队中',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已停止',retried:'已发起重试',skipped:'已跳过',review:'等待确认',partial:'待处理',idle:'未开始'};
export function productionAssetSlots(item:ProductionItem,kind:string):ProductionAssetSlot[] {
 if(kind==='角色')return [
  {id:`${item.id}:selection`,slot:'imageUrl',label:'选角',kind:'image',url:item.imageUrl,prompt:item.imagePrompt},
  {id:`${item.id}:turnaround`,slot:'turnaroundUrl',label:'三视图',kind:'image',url:item.turnaroundUrl,prompt:item.turnaroundPrompt||item.imagePrompt},
  {id:`${item.id}:expression`,slot:'expressionUrl',label:'表情图',kind:'image',url:item.expressionUrl,prompt:item.expressionPrompt||item.imagePrompt},
 ].filter(asset=>!item.imageSlots||item.imageSlots.includes(asset.slot)) as ProductionAssetSlot[];
 if(kind==='场景')return [
  {id:`${item.id}:main`,slot:'imageUrl',label:'主图',kind:'image',url:item.imageUrl,prompt:item.imagePrompt},
  {id:`${item.id}:multiview`,slot:'multiviewUrl',label:'多视角',kind:'image',url:item.multiviewUrl,prompt:item.multiviewPrompt||item.imagePrompt},
 ];
 if(kind==='分镜')return [
  {id:`${item.id}:storyboard`,slot:'imageUrl',label:'分镜图',kind:'image',url:item.imageUrl,prompt:item.imagePrompt},
  {id:`${item.id}:video`,slot:'videoUrl',label:'视频',kind:'video',url:item.videoUrl,prompt:item.videoPrompt},
  {id:`${item.id}:audio`,slot:'audioUrl',label:'音效 / 台词',kind:'audio',url:item.audioUrl,prompt:[item.audioPrompt,item.dialogue&&`台词：${item.dialogue}`].filter(Boolean).join('\n')},
 ];
 if(kind==='音乐')return [{id:`${item.id}:music`,slot:'audioUrl',label:'背景音乐',kind:'audio',url:item.audioUrl,prompt:item.description}];
 if(kind==='成片')return [{id:`${item.id}:output`,slot:'videoUrl',label:'最终成片',kind:'video',url:item.videoUrl,prompt:item.description}];
 return [
  ...(item.imageUrl?[{id:`${item.id}:image`,slot:'imageUrl',label:'图片',kind:'image' as const,url:item.imageUrl,prompt:item.imagePrompt}]:[]),
  ...(item.videoUrl?[{id:`${item.id}:video`,slot:'videoUrl',label:'视频',kind:'video' as const,url:item.videoUrl,prompt:item.videoPrompt}]:[]),
  ...(item.audioUrl?[{id:`${item.id}:audio`,slot:'audioUrl',label:'音频',kind:'audio' as const,url:item.audioUrl,prompt:item.audioPrompt}]:[]),
 ];
}
export function useProduction(projectId:string,enabled=true) {
 const [production,setProduction]=useState<Production|null>(null);
 const [stages,setStages]=useState<Stage[]>([]);
 const [submitting,setSubmitting]=useState(false);
 const [error,setError]=useState('');
 const [ready,setReady]=useState(!enabled);
 const [refreshToken,setRefreshToken]=useState(0);
 const current=useRef<Production|null>(null);
 const lock=useRef(false);
 const writes=useRef(Promise.resolve());
 const pendingWrites=useRef(0);
 const {notify}=useStudio();
 const accept=(p:Production)=>{if(!current.current||p.version>current.current.version){current.current=p;setProduction(p);}};
 useEffect(()=>{
  if(!enabled){current.current=null;setProduction(null);setStages([]);setError('');setReady(true);return;}
  setReady(false);
  let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{const response=await api<{production:Production;stages:Stage[]}>(`/projects/${projectId}/production`);if(!stopped){accept(response.production);setStages(response.stages);setError('');setReady(true);}}
   catch(e){if(!stopped){setError((e as Error).message);setReady(false);}}
   finally{if(!stopped)timer=setTimeout(poll,current.current?.status==='running'||current.current?.tasks.some(task=>['queued','running'].includes(task.status))?1200:4000);}
  };
  void poll();return()=>{stopped=true;clearTimeout(timer);};
 },[projectId,refreshToken,enabled]);
 const refresh=()=>{setError('');setReady(false);setRefreshToken(v=>v+1);};
 const command=(input:Command):Promise<boolean>=>{
  if(!enabled||!current.current||lock.current&&input.action!=='edit')return Promise.resolve(false);
  pendingWrites.current++;lock.current=true;setSubmitting(true);
  const write=async()=>{
   try{
    // Autosaves from successive role slots share one writer. Refresh before
    // unbillable edits because independent asset tasks also advance the version.
    if(input.action==='edit'){const response=await api<{production:Production}>(`/projects/${projectId}/production`);accept(response.production);}
    try{accept(await post<Production>(`/projects/${projectId}/production/commands`,{...input,version:current.current!.version}));}
    catch(error){
     if(input.action!=='edit'||!(error instanceof ApiError)||error.status!==409||!error.message.includes('状态已更新'))throw error;
     const response=await api<{production:Production}>(`/projects/${projectId}/production`);accept(response.production);
     accept(await post<Production>(`/projects/${projectId}/production/commands`,{...input,version:current.current!.version}));
    }
    return true;
   }catch(e){notify((e as Error).message,true);const response=await api<{production:Production;stages:Stage[]}>(`/projects/${projectId}/production`).catch(()=>null);if(response){accept(response.production);setStages(response.stages);setError('');setReady(true);}else{setError((e as Error).message);setReady(false);}return false;}
   finally{pendingWrites.current--;lock.current=pendingWrites.current>0;setSubmitting(lock.current);}
  };
  const result=writes.current.then(write,write);writes.current=result.then(()=>undefined,()=>undefined);return result;
 };
 const send=async(value:ComposerValue,sources:AgentDataSource[])=>{
  if(!enabled||!current.current)return;
  const p=current.current;
  const models=Object.fromEntries(['Agent','图片','视频','音频'].map(kind=>[kind,sources.find(s=>s.enabled&&s.apiKeyConfigured&&s.kind===(kind==='图片'?'图文':kind))?.defaultModel||'']));
  if(p.status==='idle')return command({action:'start',prompt:value.prompt,settings:{style:value.style,skill:value.skill,ratio:value.ratio,resolution:value.resolution,duration:value.duration,models}});
  const prompt=value.prompt.trim();
  if(/^(满意(，|,)?(请)?继续|继续(下一步)?|下一步|确认(生成)?|开始生成)$/i.test(prompt)){
   return command({action:'continue',prompt});
  }
  if(/^(先)?生成(一个|1个|一条|1条)(分镜视频)?$/.test(prompt)){
   return command({action:'continue',mode:'one',prompt});
  }
  const shotNumbers=parseShotNumbers(prompt);
  if(shotNumbers.length&&['review','partial'].includes(p.status)){
   const targetStage=p.stage==='storyboard'?'storyboard_images':p.stage==='video_prompts'?'videos':p.stage;
   if(!['storyboard_images','videos','shot_audio'].includes(targetStage))return notify('当前阶段不能按镜头编号继续；请先完成分镜或视频提示词审核。',true);
   return command({action:'continue',mode:'all',targetNumbers:shotNumbers,prompt});
  }
  if(prompt==='我要修改'||prompt==='修改一下')return notify('请点击“我要修改”，写明具体调整内容。',true);
  if(/修改|调整|改成|改为|换成|替换|删除|增加|添加|减少|重写|重做|重新生成|不满意/.test(prompt)){
   if(window.confirm('重新制作当前阶段会清除其后的成果，继续吗？'))return command({action:'revise',prompt});
   return;
  }
  return notify('请确认继续、按编号生成，或点击“我要修改”描述需要调整的内容。');
 };
 return {production,stages,submitting,error,ready,command,send,refresh,accept};
}
export type ProductionController=ReturnType<typeof useProduction>;
const ProductionContext=createContext<{inspect:(id:string,slot?:string)=>void;preview:(url:string,kind:string)=>void;replace:(id:string,slot:string)=>void}>({inspect:()=>{},preview:()=>{},replace:()=>{}});
export const ProductionProvider=ProductionContext.Provider;
export type ProductionNodeData=Record<string,unknown>&{kind:string;title:string;agent:string;text:string;item?:ProductionItem;assets?:ProductionAssetSlot[];status?:string;references?:string[];referenceImages?:string[];section?:boolean;stage?:string;subtitle?:string;cardColor?:string};
function ProductionShotCard({data,item}:{data:ProductionNodeData;item:ProductionItem}){
 const ctx=useContext(ProductionContext);
 const [slot,setSlot]=useState<'imageUrl'|'videoUrl'>(item.videoPrompt||item.videoUrl?'videoUrl':'imageUrl');
 const url=item[slot];const kind=slot==='videoUrl'?'video':'image';
 return <div className="production-shot-node">
  <div className="production-shot-tabs"><button className={slot==='imageUrl'?'active nodrag':'nodrag'} aria-label={`显示${data.title}分镜图`} onClick={()=>setSlot('imageUrl')}><Image size={14}/></button><button className={slot==='videoUrl'?'active nodrag':'nodrag'} aria-label={`显示${data.title}视频`} onClick={()=>setSlot('videoUrl')}><Film size={14}/></button></div>
  <div className={`production-shot-hero ${url?'ready':'pending'}`}>
   <button className="production-shot-content nodrag" aria-label={`查看${data.title}${slot==='imageUrl'?'图':'视频'}提示词`} onClick={()=>ctx.inspect(item.id)}>
    {url?slot==='videoUrl'?<video src={url} muted preload="metadata"/>:<img src={url} alt={data.title}/>:<div className="production-shot-prompt"><div>{data.referenceImages?.slice(0,4).map((src,i)=><img src={src} key={`${src}-${i}`} alt={`参考图 ${i+1}`}/>)}{(data.referenceImages?.length||0)>4&&<span>+{data.referenceImages!.length-4}</span>}</div><p>{slot==='videoUrl'?item.videoPrompt||'等待生成视频提示词':item.imagePrompt||'等待生成分镜图'}</p></div>}
   </button>
   <div className="production-shot-media-actions"><IconButton label={`替换${data.title}${slot==='imageUrl'?'分镜图':'视频'}`} onClick={()=>ctx.replace(item.id,slot)}><RefreshCw size={13}/></IconButton>{url&&<IconButton label={`预览${data.title}${slot==='imageUrl'?'分镜图':'视频'}`} onClick={()=>ctx.preview(url,kind)}><Eye size={13}/></IconButton>}</div>
  </div>
  <header><strong>{data.title}</strong><IconButton label={`查看${data.title}`} onClick={()=>ctx.inspect(item.id)}><Pencil size={14}/></IconButton></header>
  <p className="production-shot-description">{data.text}</p>
  <footer><small className={data.status}>{statusLabels[data.status||'']||''}</small><span>{item.duration} 秒</span>{item.audioUrl&&<IconButton label={`试听${data.title}音频`} onClick={()=>ctx.preview(item.audioUrl!,'audio')}><Volume2 size={12}/></IconButton>}</footer>
 </div>;
}
export function ProductionNode({data}:{data:ProductionNodeData}) {
 const ctx=useContext(ProductionContext);
 const rolePointer=useRef<{x:number;y:number;moved:boolean}|null>(null);
 const item=data.item;
 if(data.background)return <div className="production-group-background"/>;
 if(data.section)return <div className={`production-section-label${data.active?' active':''}`}><strong>{data.title}</strong><small>{data.subtitle}</small></div>;
 const assets=data.assets|| (item?productionAssetSlots(item,data.kind):[]);
 if(data.kind==='分镜'&&item)return <ProductionShotCard data={data} item={item}/>;
 if(data.kind==='角色'&&item){
  return <div data-role-card={item.id} onPointerDownCapture={event=>{const target=event.target as HTMLElement;rolePointer.current=target.closest('button,a,input,video,audio')?null:{x:event.clientX,y:event.clientY,moved:false};}} onPointerMoveCapture={event=>{const start=rolePointer.current;if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)start.moved=true;}} onPointerUpCapture={event=>{const target=event.target as HTMLElement,start=rolePointer.current;rolePointer.current=null;if(start&&!start.moved&&!target.closest('button,a,input,video,audio'))ctx.inspect(item.id,'card');}} className={`production-role-node ${data.cardColor?`role-color-${data.cardColor}`:''} ${assets.some(asset=>asset.slot==='turnaroundUrl')?'with-turnaround':'main-only'} ${assets.some(asset=>asset.slot==='expressionUrl')?'with-expression':''}`}>
   <header><strong>{data.title}</strong></header>
   <div className="production-role-grid">{[...assets].sort((a,b)=>Number(a.slot==='turnaroundUrl')-Number(b.slot==='turnaroundUrl')).map(asset=><section className={asset.slot==='turnaroundUrl'?'turnaround':asset.slot==='imageUrl'?'selection':'expression'} key={asset.id}>
    <label><span><Image size={13}/>{asset.label}</span><div><button className="nodrag" onClick={()=>ctx.replace(item.id,asset.slot)} aria-label="替换"><Upload size={14}/></button><button data-role-preview className="nodrag" onClick={()=>asset.url?ctx.preview(asset.url,asset.kind):ctx.inspect(item.id)} aria-label="预览"><Maximize2 size={14}/></button></div></label>
    <button data-role-asset={`${item.id}:${asset.slot}`} className={`production-role-media ${asset.url?'ready':''} nodrag`} aria-label={`编辑${data.title}的${asset.label}`} onClick={()=>ctx.inspect(item.id,asset.slot)}>{asset.url?<img src={asset.url} alt={`${data.title}${asset.label}`}/>:<><Image size={24}/><span>{asset.label}待生成</span></>}</button>
   </section>)}</div>
  </div>;
 }
 if(data.kind==='场景'&&item){
  return <div className="production-scene-node">
   <header><span>{data.title}</span><button className="nodrag" onClick={()=>ctx.inspect(item.id)}>详情</button></header>
   <div className="production-scene-grid">{assets.slice(0,2).map(asset=><section key={asset.id}>
    <div className="production-scene-label"><span><Image size={12}/>{asset.label}</span><div><button className="nodrag" onClick={()=>ctx.replace(item.id,asset.slot)} aria-label="替换"><Upload size={14}/></button><button className="nodrag" onClick={()=>asset.url?ctx.preview(asset.url,asset.kind):ctx.inspect(item.id)} aria-label="预览"><Maximize2 size={14}/></button></div></div>
    <button className="production-scene-image nodrag" onClick={()=>asset.url?ctx.preview(asset.url,asset.kind):ctx.inspect(item.id)}>{asset.url?<img src={asset.url} alt={`${data.title}${asset.label}`}/>:<><Image size={25}/><span>待生成</span></>}</button>
   </section>)}</div>
  </div>;
 }
 const primary=assets.find(asset=>asset.url)||assets[0];
 const mediaUrl=primary?.url;
 const mediaKind=primary?.kind||'image';
 const renderAsset=(asset:ProductionAssetSlot,compact=false)=><div className={`production-asset-tile ${asset.url?'ready':''}`} key={asset.id}>
  <button className="production-asset-preview nodrag" aria-label={`${asset.url?'预览':'查看'}${data.title}的${asset.label}`} onClick={()=>asset.url?ctx.preview(asset.url,asset.kind):ctx.inspect(item?.id||'script')}>
   {asset.url&&asset.kind==='image'?<img src={asset.url} alt=""/>:asset.url&&asset.kind==='video'?<video src={asset.url} muted preload="metadata"/>:asset.url&&asset.kind==='audio'?<Volume2 size={compact?15:20}/>:asset.kind==='video'?<Film size={compact?15:20}/>:<Image size={compact?15:20}/>}
  </button>
  <div className="production-asset-meta"><div><strong>{asset.label}</strong><small>{asset.url?'已生成':'待生成'}</small></div><div className="production-asset-actions">{asset.url&&<button className="nodrag" onClick={()=>ctx.preview(asset.url!,asset.kind)}>预览</button>}{item&&<button className="nodrag" onClick={()=>ctx.replace(item.id,asset.slot)}><RefreshCw size={10}/>替换</button>}</div></div>
 </div>;
 return <div className={`production-node ${data.kind==='剧本'?'script-node':''} ${data.kind==='场景'||data.kind==='分镜'?'wide-media-node':''}`}>
  <header><img src={data.agent==='编剧'?'/assets/writer.png':'/assets/director.png'} alt=""/><span>{data.agent}</span>{data.status&&<small className={data.status}>{statusLabels[data.status]||data.status}</small>}</header>
  <div className="production-node-title"><strong>{data.title}</strong><IconButton label={`查看${data.title}`} className="nodrag" onClick={()=>ctx.inspect(item?.id||'script')}><Pencil size={14}/></IconButton></div>
 {item&&<div className="production-media">
   {mediaKind==='video'&&item.videoUrl?<video src={item.videoUrl} poster={item.imageUrl} controls preload="metadata" className="nodrag nowheel"/>:mediaKind==='audio'&&item.audioUrl?<audio src={item.audioUrl} controls className="nodrag nowheel"/>:item.imageUrl?<img src={item.imageUrl} alt={data.title}/>:<div className="production-media-empty"><Image size={27}/><span>待生成</span></div>}
   {mediaUrl&&<IconButton label={`预览${data.title}`} className="nodrag" onClick={()=>ctx.preview(mediaUrl,mediaKind)}><Eye size={14}/></IconButton>}
  </div>}
  {item&&<div className={`production-asset-grid ${assets.length===2?'two':''}`}>{assets.map(asset=>renderAsset(asset,true))}</div>}
  <div className="production-node-copy"><p>{data.text||'等待制作结果'}</p>{item?.imagePrompt&&<small><b>图提示词</b>{item.imagePrompt}</small>}{item?.videoPrompt&&<small><b>视频提示词</b>{item.videoPrompt}</small>}{item?.audioPrompt&&<small><b>音效提示词</b>{item.audioPrompt}</small>}{item?.dialogue&&<small><b>台词</b>{item.dialogue}</small>}</div>
  {data.references?.length? <div className="production-references">{data.references.join(' · ')}</div>:null}
  <footer><span>{item?.duration?`${item.duration} 秒`:data.kind}</span><button className="nodrag" onClick={()=>ctx.inspect(item?.id||'script')}>{data.kind==='剧本'?'查看剧本':'提示词与详情'}<ChevronRight size={13}/></button></footer>
 </div>;
}
export type ProductionCanvasNode={id:string;type:'production';position:{x:number;y:number};width:number;height:number;draggable?:boolean;data:ProductionNodeData};
export function productionNodes(p:Production|null,origin={x:0,y:0}):ProductionCanvasNode[] {
 if(!p||p.status==='idle')return [];
 const result:ProductionCanvasNode[]=[];
 const {x,y}=origin;
 const nodeSize=(height:number,width=286)=>({width,height});
 const section=(id:string,kind:string,title:string,stage:string,subtitle:string,px:number,py:number,active:boolean,width=286)=>result.push({id,type:'production',position:{x:px,y:py},draggable:false,...nodeSize(50,width),data:{kind,title,agent:'',text:'',section:true,stage,subtitle,active}});
 const roleSize=(item:ProductionItem)=>{const slots=productionAssetSlots(item,'角色');const multi=slots.some(asset=>asset.slot==='turnaroundUrl');return {width:slots.some(asset=>asset.slot==='expressionUrl')?1076:multi?800:560,height:multi?924:424};};
 const card=(item:ProductionItem,kind:string,agent:string,px:number,py:number)=>{
  const relevant=kind==='分镜'&&['storyboard_images','videos','shot_audio'].includes(p.stage)?p.stage:undefined;
  const task=p.tasks.filter(t=>t.target?.id===item.id&&(!relevant||t.stage===relevant)).at(-1);
  const assets=productionAssetSlots(item,kind).filter(asset=>kind!=='分镜'||asset.slot!=='audioUrl'||asset.url||p.settings.separateShotAudio);
  const height=kind==='分镜'?820:kind==='剧本'?823:kind==='角色'?roleSize(item).height:kind==='场景'?300:270;
  const width=kind==='角色'?roleSize(item).width:kind==='场景'?900:kind==='分镜'?320:286;
  const status=task?.status||(relevant?(relevant==='videos'?item.videoUrl:relevant==='shot_audio'?item.audioUrl:item.imageUrl)?'completed':'pending':undefined);
  result.push({id:`production-${item.id}`,type:'production',position:{x:px,y:py},draggable:true,...nodeSize(height,width),data:{kind,agent,title:kind==='分镜'?`镜头 ${item.number}`:item.name||'',text:item.description,item,assets,status,stage:kind==='分镜'?'storyboard':kind==='角色'||kind==='场景'?'design':undefined,references:kind==='分镜'?[...(item.characterIds||[]).map(id=>p.characters.find(c=>c.id===id)?.name||''),p.scenes.find(s=>s.id===item.sceneId)?.name||''].filter(Boolean):[],referenceImages:kind==='分镜'?[item.imageUrl,...(item.characterIds||[]).map(id=>p.characters.find(c=>c.id===id)?.imageUrl),p.scenes.find(s=>s.id===item.sceneId)?.imageUrl].filter((url):url is string=>Boolean(url)):[]}});
 };
 const designActive=['design','design_images'].includes(p.stage);
 const storyboardActive=['storyboard','storyboard_images','video_prompts','videos'].includes(p.stage);
 section('production-section-script','剧本','编剧 · 剧本','script',p.script?'剧本已生成':'等待剧本',x,y,p.stage==='script',528);
 if(p.script)result.push({id:'production-script',type:'production',position:{x,y:y+38},draggable:false,...nodeSize(823,528),data:{kind:'剧本',title:p.title||'我的剧本',agent:'编剧',text:p.script,stage:'script'}});
 const assetY=y+(p.script?940:80);
 section('production-section-characters','角色','角色设计师','design',`${p.characters.length} 个角色`,x,assetY,designActive,1860);
 let roleY=assetY+38;for(let i=0;i<p.characters.length;i+=2){const row=p.characters.slice(i,i+2);row.forEach((item,column)=>card(item,'角色','角色设计师',x+column*1140,roleY));roleY+=Math.max(...row.map(item=>roleSize(item).height))+40;}
 const sceneY=roleY+80;
 section('production-section-scenes','场景','场景设计师','design',`${p.scenes.length} 个场景`,x,sceneY,designActive,1860);
 p.scenes.forEach((item,i)=>card(item,'场景','场景设计师',x+(i%2)*960,sceneY+38+Math.floor(i/2)*350));
 const storyboardY=sceneY+38+Math.max(1,Math.ceil(p.scenes.length/2))*350+80;
 result.push({id:'production-storyboard-background',type:'production',position:{x:x-30,y:storyboardY+34},width:2540,height:Math.max(1,Math.ceil(p.shots.length/7))*860+20,draggable:false,data:{kind:'分镜背景',title:'',agent:'',text:'',background:true}});
 section('production-section-storyboard','分镜','分镜师','storyboard',`${p.shots.length} 个镜头`,x,storyboardY,storyboardActive,2480);
 p.shots.forEach((item,i)=>card(item,'分镜','分镜师',x+(i%7)*360,storyboardY+38+Math.floor(i/7)*860));
 const finalY=storyboardY+38+Math.max(1,Math.ceil(p.shots.length/7))*860+80;
 section('production-section-music','音乐','音效总监','music',p.musicUrl?'背景音乐已生成':'背景音乐',x,finalY,p.stage==='music');
 section('production-section-compose','成片','艺术总监','compose',p.outputUrl?'合成已完成':'最终合成',x+340,finalY,p.stage==='compose');
 if(p.musicUrl)result.push({id:'production-music',type:'production',position:{x,y:finalY+38},draggable:false,...nodeSize(270),data:{kind:'音乐',agent:'音效总监',title:'背景音乐',text:'全片背景音乐',stage:'music',item:{id:'production-music',name:'背景音乐',description:'全片背景音乐',imagePrompt:'',audioUrl:p.musicUrl}}});
 if(p.outputUrl)result.push({id:'production-output',type:'production',position:{x:x+340,y:finalY+38},draggable:false,...nodeSize(270),data:{kind:'成片',agent:'艺术总监',title:'最终成片',text:'已完成最终合成',stage:'compose',item:{id:'production-output',name:'最终成片',description:'最终合成结果',imagePrompt:'',videoUrl:p.outputUrl},status:'completed'}});
 return result;
}
function remaining(p:Production,stage:string):ProductionItem[] {
 if(stage==='design_images')return [...p.characters.flatMap(item=>[['imageUrl','选角'],['turnaroundUrl','三视图'],['expressionUrl','表情图']].filter(([slot])=>!item.imageSlots||item.imageSlots.includes(slot)).map(([slot,label])=>({...item,id:`${item.id}:${slot}`,name:`${item.name} · ${label}`,imageUrl:item[slot as keyof ProductionItem] as string|undefined}))),...p.scenes.flatMap(item=>[['imageUrl','主图'],['multiviewUrl','多视角']].map(([slot,label])=>({...item,id:`${item.id}:${slot}`,name:`${item.name} · ${label}`,imageUrl:item[slot as keyof ProductionItem] as string|undefined})))].filter(item=>!item.imageUrl&&!p.skipped.includes(`${stage}:${item.id}`));
 const items:ProductionItem[]=stage==='music'?[{id:p.id,description:'',imagePrompt:'',audioUrl:p.musicUrl}]:p.shots;
 return items.filter(x=>!(stage==='videos'?x.videoUrl:stage==='shot_audio'||stage==='music'?x.audioUrl:x.imageUrl)&&!p.skipped.includes(`${stage}:${x.id}`));
}
type ConversationResult={id:string;label:string;mediaUrl?:string;mediaKind?:'image'|'video'|'audio'};
function mediaResult(item:ProductionItem):Pick<ConversationResult,'mediaUrl'|'mediaKind'> {
 if(item.videoUrl)return {mediaUrl:item.videoUrl,mediaKind:'video'};
 if(item.audioUrl)return {mediaUrl:item.audioUrl,mediaKind:'audio'};
 if(item.imageUrl)return {mediaUrl:item.imageUrl,mediaKind:'image'};
 return {};
}
function productionResultItems(p:Production,stage:string):ConversationResult[] {
 const all=[...p.characters,...p.scenes,...p.shots];
 const byId=new Map(all.map(item=>[item.id,item]));
 const named=(item:ProductionItem):ConversationResult=>({id:item.id,label:item.number?`镜头 ${item.number}`:item.name||item.title||item.id,...mediaResult(item)});
 if(stage==='script')return p.script?[{id:'script',label:p.title||'我的剧本'}]:[];
 if(stage==='design')return [...p.characters,...p.scenes].map(named);
 if(stage==='storyboard'||stage==='video_prompts')return p.shots.map(named);
 if(stage==='music')return p.musicUrl?[{id:'production-music',label:'背景音乐',mediaUrl:p.musicUrl,mediaKind:'audio'}]:[];
 if(stage==='compose')return p.outputUrl?[{id:'production-output',label:'最终成片',mediaUrl:p.outputUrl,mediaKind:'video'}]:[];
 const completedIds=new Set(p.tasks.filter(task=>task.stage===stage&&task.status==='completed'&&task.target).map(task=>task.target!.id));
 const candidates=stage==='design_images'?[...p.characters,...p.scenes]:p.shots;
 return candidates.filter(item=>completedIds.has(item.id)).map(item=>stage==='shot_audio'?{id:item.id,label:item.number?`镜头 ${item.number}`:item.title||item.id,mediaUrl:item.audioUrl,mediaKind:'audio' as const}:named(item)).filter(item=>byId.has(item.id));
}
export function ProductionConversation({controller,onInspect}:{controller:ProductionController;onInspect:(id:string)=>void}) {
 const {production:p,stages,submitting,command,error,refresh}=controller;
 const [modifying,setModifying]=useState(false);
 const [note,setNote]=useState('');
 const [selected,setSelected]=useState<string[]>([]);
 const [shotNumbers,setShotNumbers]=useState('');
 const [selectionError,setSelectionError]=useState('');
 const {data}=useStudio();
 useEffect(()=>{setSelected([]);setShotNumbers('');setSelectionError('');setModifying(false);},[p?.stage,p?.runId]);
 if(error)return <div className="production-error"><span>制作流程连接失败：{error}</span><button className="button small" onClick={refresh}><RotateCcw size={13}/>重新连接</button></div>;
 if(!p)return null;
 const stage=stages.find(s=>s.id===p.stage);
 if(p.status==='idle')return <div className="production-onboarding">
  <div className="production-onboarding-agent"><img src="/assets/director.png" alt=""/><div><strong>制作 Agent 已就绪</strong><span>这是 OiiOii 的制作对话：先生成方案，再逐阶段确认并写入画布。</span></div></div>
  <div className="production-onboarding-flow">{stages.slice(0,7).map((item,index)=><span key={item.id}><b>{index+1}</b>{item.title}</span>)}</div>
  <p>在下方输入创作需求后，会先进入剧本阶段；角色、场景、分镜、视频和音乐不会混成普通文本节点。</p>
 </div>;
 const busy=p.status==='running'||submitting;
 const tasks=p.tasks.filter(t=>t.stage===p.stage);
 const currentTasks=tasks.filter(t=>t.runId===p.runId);
 const failed=currentTasks.filter(t=>['failed','cancelled'].includes(t.status));
 const stageResultLabel:Record<string,string>={script:'剧本',design:'角色与场景方案',design_images:'角色 / 场景图片',storyboard:'分镜方案',storyboard_images:'分镜图片',video_prompts:'视频、音效与台词',videos:'分镜视频',shot_audio:'镜头音效与配音',music:'背景音乐',compose:'最终成片'};
 const resultGroups=stages.map(stageInfo=>({id:stageInfo.id,title:stageResultLabel[stageInfo.id]||stageInfo.title,items:productionResultItems(p,stageInfo.id),tasks:p.tasks.filter(task=>task.stage===stageInfo.id&&task.status==='completed')})).filter(group=>group.items.length>0);
 const resultCopy:Record<string,{text:string;hint:string;action:string}>={
  script:{text:'剧本已写入画布。',hint:'你可以在画布上点击剧本卡片查看完整内容。',action:'查看剧本'},
  design:{text:'角色与场景设定已写入画布。',hint:'角色和场景会在画布中按设计师分区展示。',action:'查看画布'},
  design_images:{text:'角色 / 场景主图已生成，请确认是否满意？',hint:'你也可以在画布上点击角色或场景主图查看、修改提示词。',action:'详情'},
  storyboard:{text:'分镜方案已写入画布。',hint:'每个镜头都保留了角色、场景引用和图提示词。',action:'查看分镜'},
  storyboard_images:{text:'分镜图已生成，请确认是否满意？',hint:'你也可以在画布上点击分镜图查看、修改提示词。',action:'详情'},
  video_prompts:{text:'视频、音效与台词已完成，请审核后继续。',hint:'每个镜头的三类提示词都保留在画布节点中。',action:'查看分镜'},
  videos:{text:'分镜视频已生成，请确认效果是否满意？',hint:'你也可以在画布上点击分镜卡片预览视频。',action:'详情'},
  shot_audio:{text:'镜头音效与配音已生成，请审核后继续。',hint:'每个镜头的音频产物保存在对应分镜卡片中。',action:'试听'},
  music:{text:'背景音乐已生成。',hint:'背景音乐会作为独立产物写入画布。',action:'试听'},
  compose:{text:'最终成片已合成。',hint:'可以在画布的最终成片节点中预览或下载。',action:'查看成片'},
 };
 const recoveryRequired=failed.length>0||p.status==='failed';
 const pending=['design_images','storyboard_images','videos','shot_audio','music'].includes(p.stage)?remaining(p,p.stage):[];
 let next=pending.length?stage:stages[stages.findIndex(s=>s.id===p.stage)+1];
 if(next?.id==='shot_audio'&&!p.settings.separateShotAudio)next=stages.find(s=>s.id==='music');
 const targetStage=next?.id;
 const targetItems=targetStage&&['design_images','storyboard_images','videos','shot_audio','music'].includes(targetStage)?remaining(p,targetStage):[];
 const model=next? p.settings.models?.[next.kind]||data.agentSources.find(s=>s.enabled&&s.apiKeyConfigured&&s.kind===(next.kind==='图片'?'图文':next.kind))?.defaultModel:'';
 const sourceKind=next?.kind==='图片'?'图文':next?.kind;
 const configuredModels=data.agentSources.filter(s=>s.enabled&&s.apiKeyConfigured&&s.kind===sourceKind).flatMap(s=>s.models);
 const modelUnavailable=Boolean(next&&['Agent','图片','视频','音频'].includes(next.kind)&&(!configuredModels.length||Boolean(model&&!configuredModels.some(m=>m.name===model))));
 const incompatibleDuration=(item?:ProductionItem)=>next?.kind==='视频'&&model?.startsWith('agnes-video-2.5')&&Boolean(item&&(Number(item.duration||p.settings.duration)>12||Number(item.duration||p.settings.duration)<4));
 const requestedNumbers=parseNumberList(shotNumbers);
 const requestedItems=targetItems.filter(item=>selected.length?selected.includes(item.id):requestedNumbers.length?requestedNumbers.includes(item.number||0):true);
 const durationUnavailable=requestedItems.some(incompatibleDuration);
 const oneDurationUnavailable=incompatibleDuration(requestedItems[0]);
 const retryDurationUnavailable=failed.some(task=>incompatibleDuration(p.shots.find(shot=>shot.id===task.target?.id)));
 const gateBlocked=failed.some(t=>t.kind==='Agent'||t.kind==='compose');
 const submitContinue=(mode:'one'|'all')=>{
  const ids=new Set(selected);
  let numbers:number[]=[];
  if(shotNumbers.trim()){
   const requested=parseNumberList(shotNumbers);
   if(!requested.length){setSelectionError('请输入镜头编号，例如 1, 3, 5-8。');return;}
   const matches=targetItems.filter(item=>item.number&&requested.includes(item.number));
   if(matches.length!==requested.length){setSelectionError(`待生成镜头中未找到：${requested.filter(n=>!matches.some(item=>item.number===n)).join('、')}`);return;}
   numbers=requested;
  }
  setSelectionError('');
  void command({action:'continue',mode,prompt:numbers.length?`确认生成镜头 ${numbers.join('、')}`:mode==='one'?'确认，先生成一个':'满意，请继续',...(ids.size?{targetIds:[...ids]}:{}),...(numbers.length?{targetNumbers:numbers}:{})});
 };
 const eventView=(e:Production['events'][number])=><div key={e.id} className={`production-event ${e.role}`}>
  {e.role==='assistant'&&<div className="production-agent"><img src={e.agent==='编剧'?'/assets/writer.png':'/assets/director.png'} alt=""/>{e.agent}</div>}
  <p>{e.text}</p>
 </div>;
 const resultView=(group:typeof resultGroups[number])=>{const copy=resultCopy[group.id]||{text:`${group.title}已写入画布。`,hint:'你可以在画布上点击对应产物查看详情。',action:'详情'};return <div key={group.id} className={`production-result-card ${group.id===p.stage?'current':''}`}>
  <div className="production-result-head"><div><strong>{copy.text}</strong><small>{copy.hint}</small></div><Check size={16}/></div>
  <div className="production-result-summary"><button onClick={()=>onInspect(group.items[0].id)}><span className={`result-media-dot ${group.items[0].mediaKind||''}`}/>{group.id==='script'?group.title:group.id==='design'?`${group.items.length}个角色 / 场景`:group.id==='storyboard'||group.id==='video_prompts'?`${group.items.length}个镜头`:group.id==='videos'?`${group.items.length}个视频`:group.id==='shot_audio'?`${group.items.length}个音频`:group.id==='music'?'背景音乐':`${group.items.length}个图片`}<span>{group.id==='script'?'查看':group.id==='music'?'试听':'细节'}</span><ChevronRight size={12}/></button><small>{group.tasks.length?`执行详情 · ${group.tasks.length} 个任务`:''}</small></div>
 </div>;};
 const historyEvents=p.events.slice(0,-4);
 const recentEvents=p.events.slice(-4);
 const earlierResults=resultGroups.filter(group=>group.id!==p.stage);
 const currentResult=resultGroups.find(group=>group.id===p.stage);
 return <div className="production-conversation">
  <div className="production-progress"><span>{stage?.title}</span><b>{statusLabels[p.status]||p.status}</b><div>{stages.map((s,i)=><span key={s.id} title={s.title} className={i<=stages.findIndex(x=>x.id===p.stage)?'reached':''}/>)}</div></div>
  {historyEvents.length>0&&<details className="production-history"><summary>历史对话 · {historyEvents.length} 条</summary>{historyEvents.map(eventView)}</details>}
  {recentEvents.map(eventView)}
  {currentResult&&resultView(currentResult)}
  {earlierResults.length>0&&<details className="production-history"><summary>已完成阶段 · {earlierResults.length} 项</summary>{earlierResults.map(resultView)}</details>}
  <details className="production-execution"><summary>执行详情 <span>{currentTasks.filter(t=>t.status==='completed').length}/{currentTasks.length}</span></summary>
   {tasks.map(t=><div key={t.id} className="production-task"><span>{t.status==='running'?<LoaderCircle className="spin" size={13}/>:t.status==='completed'?<Check size={13}/>:t.status==='failed'?<X size={13}/>:t.status==='retried'?<RotateCcw size={13}/>:<Square size={12}/>}</span><div><b>{t.title}</b><small>{t.runId===p.runId?'当前批次':'历史尝试'} · {statusLabels[t.status]||t.status}{t.finishedAt&&t.startedAt?` · ${Math.max(1,Math.round((Date.parse(t.finishedAt)-Date.parse(t.startedAt))/1000))} 秒`:''}</small>{t.error&&<p className="danger-text">{t.error}</p>}</div>{t.target&&<IconButton label={`查看${t.title}详情`} onClick={()=>onInspect(t.target!.id)}><ChevronRight size={14}/></IconButton>}</div>)}
  </details>
  {modelUnavailable&&<div className="production-model-warning"><strong>{model?`当前模型 ${model} 未连接`:`${sourceKind}数据源未配置`}</strong><p>请连接原项目所用模型，或选择已配置模型继续当前阶段。</p>{configuredModels.length>0&&<select aria-label="制作模型" value="" onChange={e=>void command({action:'configure',settings:{models:{[next!.kind]:e.target.value}}})}><option value="">选择已配置模型</option>{configuredModels.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select>}<a href="/agent-config">配置数据源</a></div>}
  {p.stage==='videos'&&!busy&&<label className="optional-shot-audio"><input type="checkbox" checked={Boolean(p.settings.separateShotAudio)} disabled={submitting} onChange={e=>void command({action:'configure',settings:{separateShotAudio:e.target.checked}})}/>单独生成镜头音效与配音（可选）</label>}
  {!modelUnavailable&&next&&configuredModels.length>0&&<div className="production-model-warning"><label>制作模型 <select aria-label="制作模型" value={model} disabled={busy||submitting} onChange={e=>void command({action:'configure',settings:{models:{[next.kind]:e.target.value}}})}>{configuredModels.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label></div>}
  {durationUnavailable&&<div className="production-model-warning">所选模型只支持 4–12 秒，当前待生成镜头包含不兼容时长。请在镜头详情中调整时长和提示词，或选择支持原规格的模型。原项目镜头为 15 秒。Agnes 2.5 的参考图还需公开 HTTPS 地址。</div>}
  {busy?<div className="production-gate"><button className="button" disabled={submitting} onClick={()=>void command({action:'stop'})}><Square size={13}/>停止后续任务</button></div>:p.status==='completed'?<div className="production-gate"><video src={p.outputUrl} controls/><a href={p.outputUrl} download className="button">下载成片</a><button className="button" onClick={()=>void command({action:'recompose'})}>重新合成</button></div>:<div className="production-gate">
   {p.stage==='compose'&&<button className="button primary" disabled={submitting} onClick={()=>void command({action:'recompose'})}>重新合成成片</button>}
   {failed.length>0&&<button className="button" disabled={submitting||modelUnavailable||retryDurationUnavailable} onClick={()=>void command({action:'retry'})}><RotateCcw size={14}/>重试失败任务（{failed.length}）</button>}
   {!recoveryRequired&&!gateBlocked&&next&&<>
    <div className="production-next"><strong>下一步：{next.title}</strong><small>{next.agent}{model?` · ${model}`:''}{targetItems.length?` · ${targetItems.length} 项待生成`:''}</small>{next.kind!=='Agent'&&<small>确认后提交生成任务，计入所选数据源用量</small>}</div>
    {['design_images','storyboard_images','videos','shot_audio'].includes(targetStage||'')&&targetItems.length>0&&<fieldset className="shot-selection"><legend>{targetStage==='design_images'?'选择角色 / 场景':'选择镜头'}</legend>{targetStage!=='design_images'&&<label className="shot-number-input">按编号<input value={shotNumbers} inputMode="numeric" placeholder="1, 3, 5-8" onChange={e=>{setShotNumbers(e.target.value);setSelectionError('');}}/></label>}{targetItems.map(item=><label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,item.id]:v.filter(x=>x!==item.id))}/>{item.number?`镜头 ${item.number}`:item.name||item.title||item.id}</label>)}{selectionError&&<small className="selection-error">{selectionError}</small>}</fieldset>}
    {targetItems.length>1&&<button className="button" disabled={submitting||modelUnavailable||oneDurationUnavailable} onClick={()=>submitContinue('one')}><Clapperboard size={14}/>先生成 1 个</button>}
    <button className="button primary" disabled={submitting||modelUnavailable||durationUnavailable} onClick={()=>submitContinue('all')}><Check size={14}/>{targetItems.length?`确认生成${selected.length||shotNumbers.trim()?'所选项目':`全部 ${targetItems.length} 项`}`:'满意，请继续'}</button>
   </>}
   {pending.length>0&&!gateBlocked&&<button className="button" onClick={()=>{if(window.confirm(`跳过当前 ${pending.length} 个未完成项？这些成果将不会生成。`))void command({action:'skip',targetIds:pending.map(t=>t.id)});}}>跳过未完成项（{pending.length}）</button>}
   {p.stage==='music'&&pending.length>0&&!recoveryRequired&&<button className="button" onClick={()=>void command({action:'skip',targetIds:[p.id]})}>不添加背景音乐</button>}
   <button className="button" onClick={()=>setModifying(!modifying)}><Pencil size={14}/>我要修改</button>
   {modifying&&<form className="production-revision" onSubmit={e=>{e.preventDefault();if(note.trim()&&window.confirm('重新制作此阶段会清除其后续阶段的成果，继续吗？')){void command({action:'revise',prompt:note});setNote('');}}}><textarea required aria-label="阶段修改要求" rows={4} value={note} onChange={e=>setNote(e.target.value)}/><button className="button" disabled={!note.trim()||submitting}>提交修改</button></form>}
  </div>}
 </div>;
}
export function ProductionInspector({p,id,command,onClose}:{p:Production;id:string;command:ProductionController['command'];onClose:()=>void}) {
 const ctx=useContext(ProductionContext);
 const [changes,setChanges]=useState<Record<string,string>>({});
 const [saving,setSaving]=useState(false);
 const script=id==='script'||id==='production-script';
 const music=id===p.id||id==='production-music';
 const output=id==='production-output';
 const itemId=id.startsWith('production-')?id.slice('production-'.length):id;
 const item=[...p.characters,...p.scenes,...p.shots].find(x=>x.id===id||x.id===itemId);
 const missing=!script&&!music&&!output&&!item;
 const name=item?.name||item?.title||(music?'背景音乐':output?'最终成片':p.title);
 const editable=p.status!=='running'&&item;
 const character=Boolean(item&&p.characters.some(x=>x.id===item.id));
 const scene=Boolean(item&&p.scenes.some(x=>x.id===item.id));
 const shot=Boolean(item&&p.shots.some(x=>x.id===item.id));
 const keys=character?['description','imagePrompt','turnaroundPrompt','expressionPrompt']:
  scene?['description','imagePrompt','multiviewPrompt']:
  shot?['description','imagePrompt','videoPrompt','audioPrompt','dialogue']:[];
 const itemKind=item&&(p.characters.some(x=>x.id===item.id)?'角色':p.scenes.some(x=>x.id===item.id)?'场景':p.shots.some(x=>x.id===item.id)?'分镜':'')||'';
 const assets=item?productionAssetSlots(item,itemKind):[];
 const promptKeys:Record<string,string>={imageUrl:'imagePrompt',turnaroundUrl:'turnaroundPrompt',expressionUrl:'expressionPrompt',multiviewUrl:'multiviewPrompt',videoUrl:'videoPrompt',audioUrl:'audioPrompt'};
 const labels:Record<string,string>={description:'内容',imagePrompt:'图提示词',turnaroundPrompt:'三视图提示词',expressionPrompt:'表情图提示词',multiviewPrompt:'多视角提示词',videoPrompt:'视频提示词',audioPrompt:'音效提示词',dialogue:'台词'};
 useEffect(()=>{setChanges({});setSaving(false);},[id]);
 const saveChanges=async(nextChanges=changes)=>{
  if(!item||!Object.keys(nextChanges).length)return;
  setSaving(true);
  const saved=await command({action:'edit',targetId:item.id,changes:nextChanges});
  setSaving(false);
  if(saved)setChanges({});
 };
 return <Modal title={name||'制作详情'} wide className={itemKind==='角色'?'production-character-modal':''} onClose={onClose}>
  {missing?<div className="production-missing">这项制作内容已不存在，可能已被后续修改替换。请关闭详情后，从画布或执行详情重新打开。</div>:script?<div className="production-script-full">{p.script||'剧本尚未生成。'}</div>:<div className="production-detail">
   {music&&p.musicUrl&&<div className="production-detail-media"><audio src={p.musicUrl} controls/></div>}
   {output&&p.outputUrl&&<div className="production-detail-media"><video src={p.outputUrl} controls/></div>}
   {itemKind==='角色'&&item?<div className="production-character-detail">
    <div className="production-character-overview">
     <div className="production-character-portrait">{item.imageUrl?<img src={item.imageUrl} alt={`${name}选角`}/>:<div><Image size={30}/><span>选角待生成</span></div>}</div>
     <div className="production-character-info"><span className="eyebrow">CHARACTER DESIGN</span><h3>{name}</h3><label className="form-field">角色设定<textarea rows={5} maxLength={12000} readOnly={!editable||!keys.includes('description')} value={changes.description??item.description} onChange={e=>setChanges(v=>({...v,description:e.target.value}))}/></label><p>角色主图、三视图与表情图分别保存，可独立预览、替换和修改生成提示词。</p></div>
    </div>
    <div className="production-character-assets">{assets.map(asset=>{const promptKey=promptKeys[asset.slot];return <section className={`production-character-asset ${asset.url?'ready':''}`} key={asset.id}>
     <header><div><strong>{asset.label}</strong><span>{asset.url?'已生成':'待生成'}</span></div><div>{asset.url&&<button className="button small" onClick={()=>ctx.preview(asset.url!,asset.kind)}>预览</button>}{editable&&<button className="button small" onClick={()=>ctx.replace(item.id,asset.slot)}>替换</button>}</div></header>
     <button className="production-character-image" onClick={()=>asset.url?ctx.preview(asset.url,asset.kind):undefined} aria-label={asset.url?`预览${name}${asset.label}`:`${asset.label}待生成`}>
      {asset.url?<img src={asset.url} alt={`${name}${asset.label}`}/>:<span><Image size={24}/>{asset.label}待生成</span>}
     </button>
     {promptKey&&<label className="form-field">{labels[promptKey]}<textarea rows={3} maxLength={12000} readOnly={!editable||!keys.includes(promptKey)} value={changes[promptKey]??String(item[promptKey as keyof ProductionItem]||'')} onChange={e=>setChanges(v=>({...v,[promptKey]:e.target.value}))}/></label>}
    </section>;})}</div>
   </div>:item&&<div className="production-detail-assets">{assets.map(asset=><div className={`production-detail-asset ${asset.url?'ready':''}`} key={asset.id}><div className="production-detail-asset-head"><strong>{asset.label}</strong><span>{asset.url?'已生成':'待生成'}</span><div>{asset.url&&<button className="button small" onClick={()=>asset.url&&ctx.preview(asset.url,asset.kind)}>预览</button>}{editable&&<button className="button small" onClick={()=>ctx.replace(item.id,asset.slot)}>替换</button>}</div></div>{asset.url&&<div className="production-detail-media">{asset.kind==='video'?<video src={asset.url} controls poster={item.imageUrl}/>:asset.kind==='audio'?<audio src={asset.url} controls/>:<img src={asset.url} alt={`${name}${asset.label}`}/>}</div>}{asset.prompt&&<small>{asset.prompt}</small>}</div>)}</div>}
   {shot&&item&&<label className="form-field">镜头时长（秒）<input aria-label="镜头时长" type="number" min={1} max={30} step={1} readOnly={!editable} value={changes.duration??String(item.duration||p.settings.duration||5)} onChange={e=>setChanges(v=>({...v,duration:e.target.value}))}/><small>更换时长后，请同步检查视频提示词里的时间段与对白。</small></label>}
   {item&&itemKind!=='角色'&&Object.keys(labels).filter(k=>k in item||keys.includes(k)).map(k=><label className="form-field" key={k}>{labels[k]}<textarea rows={k==='description'?3:5} maxLength={12000} readOnly={!editable||!keys.includes(k)} value={changes[k]??String(item[k as keyof ProductionItem]||'')} onChange={e=>setChanges(v=>({...v,[k]:e.target.value}))}/></label>)}
   {item&&<div className="production-references">{item.duration?`${item.duration} 秒 · `:''}{(item.characterIds||[]).map(id=>p.characters.find(c=>c.id===id)?.name).filter(Boolean).join('、')}</div>}
  </div>}
  <div className="modal-actions"><button className="button" onClick={onClose}>关闭</button>{editable&&keys.length>0&&<button className="button primary" disabled={!Object.keys(changes).length||saving} onClick={()=>void saveChanges()}>{saving?'保存中…':'保存修改'}</button>}</div>
 </Modal>;
}
