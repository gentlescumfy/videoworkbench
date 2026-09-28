import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Editor } from 'tldraw';
import { ArrowUp, Box, Check, ChevronDown, Circle, Crop, Download, Eraser, FlipHorizontal2, FlipVertical2, Image, Layers, Sun, Scan, Smile, Grid2X2, Move, Expand, Languages, Lightbulb, LoaderCircle, Maximize2, Minimize2, Paintbrush, Pencil, Plus, RefreshCw, RotateCcw, RotateCw, Scissors, Search, Shapes, SlidersHorizontal, Sparkles, Square, Undo2, Redo2, Upload, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api, post } from './api';
import { IconButton, Modal } from './components';
import { useStudio } from './studio';
import type { Asset, Job } from './types';
import type { Production, ProductionController, ProductionItem } from './production';
import './character-popover.css';

type ImageSettings=NonNullable<ProductionItem['assetSettings']>[string];
type Rect={x:number;y:number;width:number;height:number};
const promptKeys:Record<string,string>={imageUrl:'imagePrompt',turnaroundUrl:'turnaroundPrompt',expressionUrl:'expressionPrompt'};
const toolIcons:Record<string,typeof Pencil>={三视图:Box,图层拆分:Layers,深度提取:Layers,表情微调:Smile,打光:Sun,图像放大:ZoomIn,裁剪:Crop,旋转与镜像:RotateCw,画笔标记:Paintbrush,去除背景:Scissors,AI图像扩展:Expand,移除物体:Eraser,多视角:Grid2X2};
const labels:Record<string,string>={imageUrl:'主图',turnaroundUrl:'三视图',expressionUrl:'表情图'};
const editTools=[['三视图',true],['图层拆分',true],['深度提取',false],['表情微调',false],['打光',false],['图像放大',true],['裁剪',false],['旋转与镜像',false],['画笔标记',false],['去除背景',true],['AI图像扩展',false],['移除物体',true],['多视角',false]] as const;
const editInstructions:Record<string,string>={深度提取:'生成这张图片的灰度深度图，近处为白色，远处为黑色，保持原图构图。',表情微调:'保持角色身份、发型、服装和原图构图，只调整人物表情。',打光:'保持人物形象和构图，调整画面的灯光。',AI图像扩展:'保持原图主体不变，向四周自然扩展图像背景。',多视角:'生成参考图角色的多视角设定图，保持五官、服装、发型和体型一致。'};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export function CharacterPopover({p,item,slot:selectedSlot,command,accept,editorRef,onClose,onPreview,onLayout,onColor,cardColor='white'}:{p:Production;item:ProductionItem;slot:string;command:ProductionController['command'];accept:ProductionController['accept'];editorRef:MutableRefObject<Editor|null>;onClose:()=>void;onPreview:(url:string)=>void;onLayout?:(layout:'vertical'|'horizontal'|'connected')=>void;onColor?:(color:string)=>void;cardColor?:string}){
 const {data,open,upload,overlay,notify}=useStudio();
 const isCard=selectedSlot==='card';
 const slot=isCard?'imageUrl':selectedSlot;
 const promptKey=promptKeys[slot]||'imagePrompt';
 const original=String(item[promptKey as keyof ProductionItem]||'');
 const draftKey=`role-asset-draft-${p.id}-${item.id}-${slot}`;
 const [restored]=useState<{prompt:string;settings:ImageSettings;references:string[]}|null>(()=>{try{const draft=JSON.parse(localStorage.getItem(draftKey)||'null');return draft&&typeof draft.prompt==='string'&&draft.prompt.length<=12000&&Array.isArray(draft.references)&&draft.references.every((url:unknown)=>typeof url==='string')?draft:null;}catch{return null;}});
 const [prompt,setPrompt]=useState(restored?.prompt??original);
 const [settings,setSettings]=useState<ImageSettings>({ratio:slot==='turnaroundUrl'?'16:9':slot==='expressionUrl'?'3:4':'4:3',resolution:'2K',quality:'标准',...item.assetSettings?.[slot],...restored?.settings});
 const [references,setReferences]=useState<string[]>(restored?.references||item.assetReferences?.[slot]||(slot==='imageUrl'?[]:[item.imageUrl].filter((s):s is string=>Boolean(s))));
 const [tab,setTab]=useState<'description'|'prompt'|'agent'>(()=>isCard?'description':'prompt');
 const [menu,setMenu]=useState('');
 const [confirmSettings,setConfirmSettings]=useState(false);
 const [confirmation,setConfirmation]=useState(p.settings.confirmation||{image:false,audio:false,video:false,cooldown:true,threshold:100});
 const [pendingGenerate,setPendingGenerate]=useState<{instruction?:string;references?:string[]}|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [rect,setRect]=useState<Rect>({x:window.innerWidth/2-222,y:window.innerHeight*.36-166,width:444,height:333});
 const [width,setWidth]=useState(680);
 const [busy,setBusy]=useState('');
 const [agentNote,setAgentNote]=useState('');
 const [currentReferenceVisible,setCurrentReferenceVisible]=useState(true);
 const [agentPrefixWidth,setAgentPrefixWidth]=useState(130);
 const agentPrefix=useRef<HTMLDivElement>(null);
 const [agentMessages,setAgentMessages]=useState<{role:string;text:string}[]>([]);
 const [assistant,setAssistant]=useState(false);
 const [assistantMode,setAssistantMode]=useState('');
 const [assistantNote,setAssistantNote]=useState('');
 const [assistantResult,setAssistantResult]=useState('');
 const [smart,setSmart]=useState(false);
 const [tool,setTool]=useState('涂抹');
 const [erase,setErase]=useState(false);
 const [brush,setBrush]=useState(24);
 const [strokes,setStrokes]=useState<{points:number[][];size:number;erase:boolean;box:boolean}[]>([]);
 const [future,setFuture]=useState<typeof strokes>([]);
 const [imageTool,setImageTool]=useState('');
 const [rotation,setRotation]=useState(0);
 const [flipped,setFlipped]=useState(false);
 const [cropRatio,setCropRatio]=useState('原始比例');
 const [crop,setCrop]=useState({x:0,y:0,w:1,h:1});
 const [verticalFlip,setVerticalFlip]=useState(false);
 const [dirty,setDirty]=useState(Boolean(restored));
 const [description,setDescription]=useState(item.description||'');
 const descriptionRef=useRef(description);descriptionRef.current=description;
 const descriptionSave=useRef<Promise<boolean>|null>(null);
 const descriptionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const descriptionDirty=useRef(false);
 const wrap=useRef<HTMLDivElement>(null);
 const fileInput=useRef<HTMLInputElement>(null);
 const mask=useRef<HTMLCanvasElement>(null);
 const drawing=useRef(false);
 const latest=useRef({prompt,settings,references,dirty});latest.current={prompt,settings,references,dirty};
 const saving=useRef<Promise<boolean>|null>(null);
 const mounted=useRef(true);
 const revision=useRef(0);
 const imageSources=data.agentSources.filter(source=>source.kind==='图文'&&source.enabled&&source.apiKeyConfigured);
 const configured=imageSources.flatMap(source=>source.models.map(model=>({...model,source:source.name})));
 const selectedModel=settings.model||p.settings.models?.['图片']||'oii-image-2';
 const modelLabel=/^oii-image/i.test(selectedModel)?selectedModel.includes('2.5')?'Oii Image 2.5 Fast':'Oii Image 2':selectedModel;
 const canGenerate=configured.some(model=>model.name===selectedModel);
 const selectedUrl=String(item[slot as keyof ProductionItem]||'');
 const currentTask=p.tasks.filter(task=>task.target?.id===item.id&&task.target.slot===slot).at(-1);
 const generating=['queued','running'].includes(currentTask?.status||'');
 const changePrompt=(value:string)=>{setPrompt(value);setDirty(true);revision.current++;};
 const changeSettings=(value:Partial<ImageSettings>)=>{setSettings(current=>({...current,...value}));setDirty(true);revision.current++;};
 const changeReferences=(value:string[])=>{setReferences(value);setDirty(true);revision.current++;};
 useLayoutEffect(()=>{
  const label=agentPrefix.current;if(!label)return;
  const measure=()=>setAgentPrefixWidth(Math.ceil(label.getBoundingClientRect().width)+8);
  measure();const observer=new ResizeObserver(measure);observer.observe(label);return()=>observer.disconnect();
 },[tab,smart,item.name,slot]);
 const save=():Promise<boolean>=>{
  if(saving.current)return saving.current;
  if(!latest.current.dirty)return Promise.resolve(true);
  const drain=async()=>{
   while(latest.current.dirty){
    const rev=revision.current,values=latest.current;
    const ok=await command({action:'edit',targetId:item.id,assetSlot:slot,changes:{[promptKey]:values.prompt},assetSettings:values.settings,assetReferences:values.references});
    if(!ok)return false;
    if(revision.current===rev){latest.current.dirty=false;try{const saved=JSON.stringify({prompt:values.prompt,settings:values.settings,references:values.references});if(localStorage.getItem(draftKey)===saved)localStorage.removeItem(draftKey);}catch{}if(mounted.current)setDirty(false);}
   }
   return true;
  };
  saving.current=drain().finally(()=>{saving.current=null;});return saving.current;
 };
 const saveRef=useRef(save);saveRef.current=save;
 const saveDescription=()=>{
  if(descriptionSave.current)return descriptionSave.current;
  if(!descriptionDirty.current)return Promise.resolve(true);
  const value=descriptionRef.current;
  descriptionSave.current=command({action:'edit',targetId:item.id,changes:{description:value}}).then(ok=>{if(ok&&descriptionRef.current===value)descriptionDirty.current=false;return ok;}).finally(()=>{descriptionSave.current=null;});
  return descriptionSave.current;
 };
 const close=()=>{clearTimeout(descriptionTimer.current);void Promise.all([save(),saveDescription()]).then(results=>{if(results.every(Boolean))onClose();});};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(latest.current.dirty&&!saving.current)void saveRef.current();};},[]);
 useEffect(()=>{if(!dirty)return;try{localStorage.setItem(draftKey,JSON.stringify({prompt,settings,references}));}catch{}const timer=setTimeout(()=>void saveRef.current(),700);return()=>clearTimeout(timer);},[prompt,settings,references,dirty]);
 useEffect(()=>{if(!isCard||!descriptionDirty.current)return;descriptionTimer.current=setTimeout(()=>void saveDescription(),700);return()=>clearTimeout(descriptionTimer.current);},[description,isCard]);
 useLayoutEffect(()=>{
  const editor=editorRef.current;
  const target=isCard?[...document.querySelectorAll<HTMLElement>('[data-role-card]')].find(el=>el.dataset.roleCard===item.id):[...document.querySelectorAll<HTMLElement>('[data-role-asset]')].find(el=>el.dataset.roleAsset===`${item.id}:${slot}`);
  if(!editor||!target)return;
  if(!isCard){target.dataset.active='true';const current=target.getBoundingClientRect();const point=editor.screenToPage({x:current.x+current.width/2,y:current.y+current.height/2});const viewport=editor.getViewportScreenBounds();const z=Math.min(1,(viewport.h-200)/(current.height/editor.getZoomLevel()+500));editor.setCamera({x:viewport.w/2/z-point.x,y:viewport.h*(imageTool ? .5 : .36)/z-point.y,z},{animation:{duration:300}});}
  let frame=0;
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const bounds=target.getBoundingClientRect();setRect({x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height});});};
  measure();const stop=editor.store.listen(measure,{scope:'all'});window.addEventListener('resize',measure);
  return()=>{target.removeAttribute('data-active');stop();cancelAnimationFrame(frame);window.removeEventListener('resize',measure);};
 },[item.id,slot,isCard,editorRef,imageTool]);
 useEffect(()=>{
  if(overlay||assistant||confirmSettings||pendingGenerate)return;
  const outside=(event:PointerEvent)=>{const target=event.target as HTMLElement;if(wrap.current?.contains(target)||target.closest('[data-role-card],[data-role-asset],[data-role-preview],.character-image-lightbox,.character-image-toolbar,.character-mask,.character-resize-handle,.character-inline-editor'))return;close();};
  const key=(event:KeyboardEvent)=>{if((event.target as HTMLElement).closest('.character-image-lightbox'))return;if(event.key==='Escape'){event.preventDefault();if(menu)setMenu('');else if(expanded)setExpanded(false);else close();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
 });
 const ask=async(instruction:string,withImages=false)=>{
  const source=data.agentSources.find(source=>source.kind==='Agent'&&source.enabled&&source.apiKeyConfigured);
  if(!source)throw new Error('请先配置可用的 Agent 数据源');
  const refs=withImages?[...new Set([selectedUrl,...latest.current.references].filter(Boolean))]:[];
  if(refs.length>10)throw new Error('最多引用 10 张图片，请减少参考图');
  let job=await post<Job>('/generate',{projectId:p.id,kind:'Agent',model:source.defaultModel,prompt:instruction,settings:{workflow:false,...(withImages?{references:refs,history:agentMessages.slice(-12),style:latest.current.settings.style}: {})}});
  while(job.status==='running'||job.status==='queued'){await delay(1200);job=await api<Job>(`/jobs/${job.id}`);}
  if(job.status!=='completed'||!job.text)throw new Error(job.error||'Agent 没有返回内容');
  return job.text;
 };
 const transformPrompt=async(mode:string,note='')=>{
  setBusy(mode);
  try{const result=await ask(`${mode}以下图片提示词。保持人物身份、外貌特征、图片规格和构图约束。只返回处理后的提示词，不要解释。${note?`\n调整要求：${note}`:''}\n${latest.current.prompt}`);return result;}
  catch(error){notify((error as Error).message,true);return '';}
  finally{setBusy('');}
 };
 const regenerate=async(instruction?:string,extraReferences?:string[],confirmed=false)=>{
  if(generating||busy)return;
  if(!canGenerate){setMenu('models');notify('请选择已配置的图片模型；原站 Oii Image 模型尚未连接。',true);return;}
  if(!confirmed){setPendingGenerate({instruction,references:extraReferences});return;}
  setBusy('生成');
  try{
   if(!await save())return;
   // Read the accepted version after saving instead of submitting a stale render version.
   const response=await api<{production:Production}>(`/projects/${p.id}/production`);
   const refs=extraReferences||latest.current.references;
   const result=await post<{production:Production;taskId:string}>(`/projects/${p.id}/production/assets/generate`,{version:response.production.version,targetId:item.id,assetSlot:slot,model:selectedModel,...(instruction?{prompt:instruction}:{}),references:refs});
   accept(result.production);
   notify('已提交角色图片任务，生成结果会写回当前素材。');
  }catch(error){notify((error as Error).message,true);}
  finally{setBusy('');}
 };
 const chooseReference=()=>open('asset-picker',{select:(asset:Asset)=>{if(!asset.mime.startsWith('image/')){notify('请选择图片素材',true);return;}changeReferences([...new Set([...latest.current.references,asset.url])]);}});
 const uploadReference=async(files:File[])=>{const assets=await upload(files,'角色');changeReferences([...new Set([...latest.current.references,...assets.filter(asset=>asset.mime.startsWith('image/')).map(asset=>asset.url)])]);};
 const sendAgent=async()=>{
  if(!agentNote.trim()||busy)return;
  const note=agentNote;setAgentNote('');setAgentMessages(current=>[...current,{role:'user',text:note}]);setBusy('Agent');
  try{const answer=await ask(`你是角色设计师，正在协助修改「${item.name}」的${labels[slot]}。角色设定：${item.description}\n当前图片提示词：${latest.current.prompt}\n用户要求：${note}\n请回答用户的问题。若用户明确要求修改提示词，返回 JSON {"reply":"简短说明","prompt":"完整修改后的图片提示词"}，否则直接回答。不要声称图片已经生成。`,true);let text=answer;try{const value=JSON.parse(answer.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));text=value.reply||answer;if(typeof value.prompt==='string')changePrompt(value.prompt);}catch{}setAgentMessages(current=>[...current,{role:'assistant',text}]);}
  catch(error){notify((error as Error).message,true);setAgentNote(note);}
  finally{setBusy('');}
 };
 const download=()=>{if(!selectedUrl)return;const a=document.createElement('a');a.href=selectedUrl;a.download=`${item.name}-${labels[slot]}.png`;a.click();};
 const chooseTool=(name:string)=>{setMenu('');if(name==='裁剪'||name==='旋转与镜像'){setImageTool(name);setRotation(0);setFlipped(false);setVerticalFlip(false);setCropRatio('原始比例');setCrop({x:0,y:0,w:1,h:1});return;}setSmart(true);if(name==='画笔标记'){setAgentNote('');return;}setAgentNote(editInstructions[name]||'');};
 const applyImageTransform=async()=>{
  if(!selectedUrl)return;setBusy('图像编辑');
  try{const image=new window.Image();image.src=selectedUrl;await image.decode();const canvas=document.createElement('canvas');let sw=image.naturalWidth,sh=image.naturalHeight;
   if(imageTool==='裁剪'){sw*=crop.w;sh*=crop.h;}
   const quarter=rotation%180!==0;canvas.width=quarter?Math.round(sh):Math.round(sw);canvas.height=quarter?Math.round(sw):Math.round(sh);const context=canvas.getContext('2d')!;context.translate(canvas.width/2,canvas.height/2);context.rotate(rotation*Math.PI/180);context.scale(flipped?-1:1,verticalFlip?-1:1);context.drawImage(image,imageTool==='裁剪'?crop.x*image.naturalWidth:0,imageTool==='裁剪'?crop.y*image.naturalHeight:0,sw,sh,-sw/2,-sh/2,sw,sh);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片编辑失败');const [asset]=await upload([new File([blob],`${item.name}-${imageTool}.png`,{type:'image/png'})],'角色');if(asset&&await save()&&await command({action:'replace_asset',targetId:item.id,assetSlot:slot,assetUrl:asset.url}))setImageTool('');
  }catch(error){notify((error as Error).message,true);}finally{setBusy('');}
 };
 useEffect(()=>{if(!smart||!mask.current)return;const canvas=mask.current,context=canvas.getContext('2d')!;context.clearRect(0,0,canvas.width,canvas.height);for(const stroke of strokes){const points=stroke.points.map(([x,y])=>[x,y*canvas.height/1000]);context.globalCompositeOperation=stroke.erase?'destination-out':'source-over';context.strokeStyle='#ed27b685';context.fillStyle='#ed27b65c';context.lineWidth=stroke.size;context.lineCap='round';context.lineJoin='round';if(stroke.box&&stroke.points.length>1){const [a,b]=[points[0],points.at(-1)!];context.fillRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}else{context.beginPath();points.forEach(([x,y],i)=>i?context.lineTo(x,y):context.moveTo(x,y));if(points.length===1)context.lineTo(points[0][0]+.1,points[0][1]);context.stroke();}}},[strokes,smart,rect.width,rect.height]);
 const drawPoint=(event:React.PointerEvent<HTMLCanvasElement>)=>{const r=event.currentTarget.getBoundingClientRect();return [(event.clientX-r.x)*1000/r.width,(event.clientY-r.y)*1000/r.height];};
 const smartGenerate=async()=>{
  if(!agentNote.trim())return;
  try{
   const refs=[selectedUrl,...references].filter(Boolean);
   if(strokes.length&&mask.current){const canvas=document.createElement('canvas');const image=new window.Image();image.src=selectedUrl;await image.decode();canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);context.drawImage(mask.current,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(blob){const [asset]=await upload([new File([blob],'marked-reference.png',{type:'image/png'})],'角色');if(asset)refs.push(asset.url);}}
   await regenerate(`基于参考图修改，保持未要求修改的角色身份、构图和细节。${strokes.length?'最后一张图片的粉色标记指定需要修改的区域。':''}\n修改要求：${agentNote}`,refs);
  }catch(error){notify((error as Error).message,true);}
 };
 const popupHeight=smart?234:tab==='description'?228:tab==='agent'?270:483;
 const popupWidth=smart?580:isCard?680:width;
 const popupX=isCard?Math.max(16,window.innerWidth/2-340):Math.max(16,Math.min(window.innerWidth-popupWidth-16,rect.x+rect.width/2-popupWidth/2));
 const popupY=isCard?Math.max(80,window.innerHeight*.552):Math.max(80,Math.min(window.innerHeight-popupHeight-70,rect.y+rect.height+8));
 const toolbarX=Math.max(16,Math.min(window.innerWidth-(isCard?442:600),rect.x+rect.width/2-(isCard?213:smart?282:236)));
 const toolbarY=Math.max(65,rect.y-56);
 const syncAssets=async()=>{setBusy('同步资产');try{const slots=[['imageUrl',item.imageUrl],['turnaroundUrl',item.turnaroundUrl],['expressionUrl',item.expressionUrl]].filter((entry):entry is [string,string]=>Boolean(entry[1]));const missing=slots.filter(([,url])=>!data.assets.some(asset=>asset.url===url));if(!missing.length){notify('角色图片已在资产库中');return;}for(const [assetSlot,url] of missing){const response=await fetch(url);if(!response.ok)throw new Error(`无法读取${labels[assetSlot]}图片`);const blob=await response.blob();const [asset]=await upload([new File([blob],`${item.name}-${labels[assetSlot]}.png`,{type:blob.type||'image/png'})],'角色');if(!asset)throw new Error('上传资产库失败');}notify(`已同步 ${missing.length} 张角色图片到资产库`);}catch(error){notify((error as Error).message,true);}finally{setBusy('');}};
 const downloadCard=()=>{[['imageUrl',item.imageUrl],['turnaroundUrl',item.turnaroundUrl],['expressionUrl',item.expressionUrl]].forEach(([assetSlot,url])=>{if(!url)return;const a=document.createElement('a');a.href=url;a.download=`${item.name}-${labels[assetSlot]}.png`;a.click();});};
 const resize=(event:React.PointerEvent<HTMLDivElement>,side:number)=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const start=event.clientX,startWidth=width;const element=event.currentTarget;const move=(e:PointerEvent)=>setWidth(Math.max(480,Math.min(1000,startWidth+(e.clientX-start)*side*2)));const done=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',done);};element.addEventListener('pointermove',move);element.addEventListener('pointerup',done);};
 const toolMenu=<div className="character-menu character-edit-menu" role="menu">{editTools.map(([name,disabled])=>{const ToolIcon=toolIcons[name];return <button role="menuitem" disabled={disabled} key={name} onClick={()=>chooseTool(name)}><ToolIcon size={15}/>{name}</button>;})}</div>;
 return <>
  {!imageTool&&isCard&&<div className="character-image-toolbar character-card-toolbar" style={{left:toolbarX,top:toolbarY}}>
   <button disabled={Boolean(busy)} onClick={()=>void syncAssets()}><Upload size={16}/>{busy==='同步资产'?'同步中…':'同步资产库'}</button><span className="character-divider"/>
   <div className="character-toolbar-group"><button onClick={()=>{setTab('agent');setAgentNote('为这个角色补充外貌、表情和声音的完整设定');setMenu('');}}>派生<ChevronDown size={12}/></button></div>
   <span className="character-divider"/><div className="character-toolbar-group"><button aria-expanded={menu==='sort'} onClick={()=>setMenu(menu==='sort'?'':'sort')}>排序<ChevronDown size={12}/></button>{menu==='sort'&&<div className="character-menu card-sort-menu" role="menu">{[['vertical','垂直布局'],['horizontal','水平布局'],['connected','连线布局']].map(([key,label])=><button role="menuitem" key={key} onClick={()=>{onLayout?.(key as 'vertical'|'horizontal'|'connected');setMenu('');}}>{label}</button>)}</div>}</div>
   <div className="character-toolbar-group"><button aria-label="卡片颜色" aria-expanded={menu==='color'} onClick={()=>setMenu(menu==='color'?'':'color')}><span className={`character-color-dot role-color-dot-${cardColor}`}/></button>{menu==='color'&&<div className="character-menu card-color-menu" role="menu">{[['white','#f5f5f5'],['pink','#f2bddb'],['yellow','#f1d68a'],['purple','#cbb7ec'],['coral','#f0aa98'],['blue','#a9ceef'],['green','#b4d6b3'],['cyan','#a8dfdf']].map(([key,color])=><button role="menuitemradio" aria-label={({pink:'粉色',yellow:'黄色',purple:'紫色',coral:'珊瑚色',blue:'蓝色',green:'绿色',cyan:'青色',white:'白色'} as Record<string,string>)[key]} key={key} onClick={()=>{onColor?.(key);setMenu('');}}><span className="character-color-dot" style={{background:color}}/></button>)}</div>}</div>
   <span className="character-divider"/><button aria-label="下载角色图片" onClick={downloadCard}><Download size={16}/></button>
  </div>}
  {!imageTool&&!isCard&&<div className={`character-image-toolbar ${smart?'smart':''}`} style={{left:toolbarX,top:toolbarY}}>
   {smart?<><button onClick={close}><X size={18}/>智能编辑</button><span className="character-divider"/>{['涂抹','框选'].map(name=><button className={tool===name?'active':''} aria-pressed={tool===name} key={name} onClick={()=>setTool(name)}>{name==='涂抹'?<Paintbrush size={16}/>:<Scissors size={16}/>} {name}</button>)}<span className="character-divider"/><IconButton label="画笔" aria-pressed={!erase} className={!erase?'active':''} onClick={()=>setErase(false)}><Paintbrush size={17}/></IconButton><IconButton label="橡皮擦" aria-pressed={erase} className={erase?'active':''} onClick={()=>setErase(true)}><Eraser size={17}/></IconButton><input aria-label="画笔大小" type="range" min="4" max="64" value={brush} onChange={e=>setBrush(Number(e.target.value))}/><span className="character-divider"/><IconButton label="撤销标记" disabled={!strokes.length} onClick={()=>{setFuture(current=>[strokes.at(-1)!,...current]);setStrokes(current=>current.slice(0,-1));}}><Undo2 size={16}/></IconButton><IconButton label="重做标记" disabled={!future.length} onClick={()=>{setStrokes(current=>[...current,future[0]]);setFuture(current=>current.slice(1));}}><Redo2 size={16}/></IconButton></>:<><div className="character-toolbar-group"><button aria-expanded={menu==='derive'} onClick={()=>setMenu(menu==='derive'?'':'derive')}><Pencil size={18}/>派生<ChevronDown size={12}/></button>{menu==='derive'&&<div className="character-menu derive-menu" role="menu"><button role="menuitem" onClick={()=>{setTab('agent');setAgentNote('为这个角色补充外貌、表情和声音的完整设定');setMenu('');}}>全部 <small>1/5s</small></button><button role="menuitem" onClick={()=>{setTab('agent');setAgentNote('为这个角色设计合适的音色，描述年龄、音域、语速和语气');setMenu('');}}>音色 <small>1/5s</small></button></div>}</div><span className="character-divider"/><button onClick={()=>{setSmart(true);setMenu('');}}><WandSparkles size={18}/>智能编辑</button><span className="character-divider"/><div className="character-toolbar-group"><button aria-expanded={menu==='edit'} onClick={()=>setMenu(menu==='edit'?'':'edit')}><WandSparkles size={18}/>编辑<ChevronDown size={12}/></button>{menu==='edit'&&toolMenu}</div><span className="character-divider"/><button disabled={generating||Boolean(busy)} onClick={()=>void regenerate()}><RefreshCw size={17}/>重新生成</button><span className="character-divider"/><IconButton label="下载" onClick={download} disabled={!selectedUrl}><Download size={16}/></IconButton></>}
  </div>}
  {!imageTool&&smart&&<canvas ref={mask} width={1000} height={Math.max(1,Math.round(1000*rect.height/rect.width))} className="character-mask" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drawing.current=true;const point=drawPoint(e);setFuture([]);setStrokes(current=>[...current,{points:[point],size:brush*1000/rect.width,erase,box:tool==='框选'}]);}} onPointerMove={e=>{if(!drawing.current)return;const point=drawPoint(e);setStrokes(current=>current.map((stroke,i)=>i===current.length-1?{...stroke,points:[...stroke.points,point]}:stroke));}} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/>}
  {!imageTool&&<div ref={wrap} className={`character-node-popover ${isCard?'character-card-popover':''} ${expanded?'expanded':''} ${smart?'smart-popover':''}`} role="dialog" aria-label={isCard?`${item.name}角色卡片`:`${item.name} · ${labels[slot]}节点对话`} style={expanded?undefined:{left:popupX,top:popupY,width:popupWidth,height:popupHeight}} onPointerDown={e=>e.stopPropagation()}>
   {!smart&&<header><div role="tablist" aria-label="节点对话">{(isCard?['description','prompt','agent'] as const:['prompt','agent'] as const).map(value=><button role="tab" aria-selected={tab===value} className={tab===value?'active':''} key={value} onClick={()=>{setTab(value);setMenu('');}}>{value==='description'?'角色描述':value==='prompt'?'提示词':'Agent 对话'}</button>)}</div><div className="character-header-actions">{tab==='prompt'?<><button onClick={()=>open('templates',{select:(value:string)=>changePrompt(value)})}><Lightbulb size={14}/>模板</button><button onClick={()=>{setAssistant(true);setAssistantResult('');setAssistantMode('');}}><Sparkles size={14}/>提示词助手</button><span className="character-divider"/><IconButton label="翻译" disabled={Boolean(busy)} onClick={()=>void transformPrompt('翻译成英文').then(value=>value&&changePrompt(value))}><Languages size={16}/></IconButton><IconButton label={expanded?'收起输入框':'展开输入框'} onClick={()=>setExpanded(!expanded)}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</IconButton></>:tab==='agent'?<IconButton label="二次确认" onClick={()=>{setConfirmation(p.settings.confirmation||{image:false,audio:false,video:false,cooldown:true,threshold:100});setConfirmSettings(true);}}><SlidersHorizontal size={15}/></IconButton>:null}</div></header>}
   <input hidden ref={fileInput} type="file" accept="image/*" multiple onChange={e=>{void uploadReference(Array.from(e.target.files||[]));e.target.value='';}}/>
   <div className="character-popover-content">
    {!(isCard&&tab==='description')&&<div className="character-reference-row">{(tab==='agent'&&!smart?[...(currentReferenceVisible?[selectedUrl]:[]),...references]:references).filter(Boolean).filter((url,i,all)=>all.indexOf(url)===i).map(url=><div key={url}><button onClick={()=>onPreview(url)}><img src={url} alt="参考图片"/></button><IconButton label="移除参考图片" onClick={()=>{if(tab==='agent'&&url===selectedUrl)setCurrentReferenceVisible(false);if(references.includes(url))changeReferences(references.filter(reference=>reference!==url));}}><X size={10}/></IconButton></div>)}{(tab==='prompt'||smart)&&<button className="character-add-image" aria-label={smart?'上传图片':'图片'} onClick={()=>fileInput.current?.click()}><Plus size={19}/>{smart&&<small>上传</small>}</button>}</div>}
    {isCard&&tab==='description'&&!smart?<textarea className="character-description-input" aria-label="角色描述" value={description} maxLength={12000} onChange={e=>{descriptionDirty.current=true;setDescription(e.target.value);}} placeholder="描述角色的外貌、性格和背景"/>:tab==='prompt'&&!smart?<textarea className="character-prompt-input" aria-label={`${labels[slot]}提示词`} value={prompt} maxLength={12000} onBlur={()=>void save()} onChange={e=>changePrompt(e.target.value)} readOnly={p.status==='running'} placeholder="描述你想要生成的图片"/>:<><div className="character-agent-messages">{agentMessages.map((message,i)=><p className={message.role} key={i}>{message.text}</p>)}</div><div className={`character-agent-composer ${smart?'smart':''}`}>{!smart&&<div ref={agentPrefix} className="character-agent-label"><span>{selectedUrl&&<img src={selectedUrl} alt=""/>}{item.name}</span>{labels[slot]}：</div>}<textarea className="character-agent-input" style={smart?undefined:{textIndent:agentPrefixWidth}} aria-label={smart?'智能编辑要求':'Agent 对话输入'} value={agentNote} onChange={e=>setAgentNote(e.target.value)} placeholder={smart?'描述你想要的修改，例如「把背景换成海边」；也可上传图片或点「引用」使用画布上其他图片内容作为参考':'输入 @ 引用图片并设置参考'} onKeyDown={e=>{if(e.key==='@')chooseReference();}}/></div></>}
   </div>
   {currentTask?.status==='failed'&&<div className="character-task-notice" role="status"><span>{currentTask.error}</span>{currentTask.outputUrl&&<button onClick={()=>onPreview(currentTask.outputUrl!)}>查看生成结果</button>}</div>}
   <footer>
    {isCard&&tab==='description'&&!smart?<><span className="character-description-status">{descriptionDirty.current?'自动保存中':'角色设定'}</span><div className="character-footer-spacer"/><button className="character-description-save" onClick={()=>void saveDescription()} disabled={!descriptionDirty.current}>保存</button></>:<>
    {tab==='agent'&&!smart?<><IconButton label="上传图片" onClick={()=>fileInput.current?.click()}><Plus size={19}/></IconButton><span className="character-divider"/></>:null}
    {(tab==='prompt'||smart)&&<div className="character-model-wrap"><button aria-expanded={menu==='models'} title={`生成模型：${selectedModel}`} onClick={()=>setMenu(menu==='models'?'':'models')}><Box size={15}/>{smart&&!settings.model?'Oii Image 2.5 Fast':modelLabel}<ChevronDown size={12}/></button>{menu==='models'&&<div className="character-menu model-menu" role="menu"><p>图片模型</p><button role="menuitem" disabled>Oii Image 2 <small>未连接</small></button><button role="menuitem" disabled>Oii Image 2.5 Fast <small>未连接</small></button>{configured.map(model=><button key={model.id} role="menuitem" onClick={()=>{changeSettings({model:model.name});setMenu('');}}><span>{model.name}<small>{model.source}</small></span>{selectedModel===model.name&&<Check size={15}/>}</button>)}</div>}</div>}
    {!smart&&<button onClick={()=>open('styles',{select:(value:string)=>changeSettings({style:value})})}><Shapes size={14}/>{settings.style||'风格'}{tab==='agent'&&<ChevronDown size={12}/>}</button>}
    {tab==='agent'&&!smart&&<button onClick={chooseReference}><Circle size={14}/>资产<ChevronDown size={12}/></button>}
    <div className="character-footer-spacer"/>
    {tab==='prompt'&&!smart&&<div className="character-params-wrap"><button aria-expanded={menu==='params'} onClick={()=>setMenu(menu==='params'?'':'params')}><SlidersHorizontal size={14}/>{settings.ratio} · {settings.resolution} · {settings.quality||'标准'}<ChevronDown size={11}/></button>{menu==='params'&&<div className="character-params-panel"><label>比例</label><div className="character-ratios">{['1:1','2:3','3:2','9:16','16:9','3:4','4:3','21:9','Auto'].map(ratio=><button disabled className={ratio===settings.ratio?'active':''} key={ratio}><Square size={16}/>{ratio}</button>)}</div><label>分辨率</label><div className="character-segmented">{['1K','2K','4K'].map(resolution=><button key={resolution} className={settings.resolution===resolution?'active':''} onClick={()=>changeSettings({resolution})}>{resolution}</button>)}</div><label className="character-switch-row">透明背景<button role="switch" aria-checked={Boolean(settings.transparent)} aria-label="透明背景" className={settings.transparent?'on':''} onClick={()=>changeSettings({transparent:!settings.transparent})}><span/></button></label><label>质量</label><div className="character-segmented">{['低','标准','高'].map(quality=><button key={quality} className={settings.quality===quality?'active':''} onClick={()=>changeSettings({quality})}>{quality}</button>)}</div><label>生成数量</label><div className="character-segmented">{['1','2','4'].map(count=><button disabled key={count} className={count==='1'?'active':''}>{count}</button>)}</div></div>}</div>}
    <div className={`character-submit-group ${tab==='agent'&&!smart?'agent-send':''}`} title={canGenerate?'生成服务的实际用量以所选数据源为准':'原站模型未连接，请选择已配置的图片模型'}>{(tab==='prompt'||smart)&&<span><Box size={14}/>7</span>}<IconButton label={tab==='agent'&&!smart?'发送':'生成图片'} disabled={Boolean(busy)||generating||(smart||tab==='agent'?!agentNote.trim():!prompt.trim())||p.status==='running'} onClick={()=>smart?void smartGenerate():tab==='agent'?void sendAgent():void regenerate()}>{busy||generating?<LoaderCircle size={18} className="spin"/>:<ArrowUp size={18}/>}</IconButton></div>
    </>}
   </footer>
   {!smart&&<><div className="character-resize-handle left" role="separator" aria-label="从左侧调整节点对话宽度" onPointerDown={e=>resize(e,-1)}/><div className="character-resize-handle right" role="separator" aria-label="从右侧调整节点对话宽度" onPointerDown={e=>resize(e,1)}/></>}
  </div>}
  {confirmSettings&&<Modal title="二次确认设置" className="character-confirm-settings" onClose={()=>setConfirmSettings(false)}><p>管理当前项目内图片、音频和视频生成的二次确认规则。</p><div className="character-confirm-body"><section aria-label="不再提醒的项目"><h3>不再提醒的项目</h3><div className="character-confirm-rows">{(['image','audio','video'] as const).map((key,i)=><div className="character-confirm-row" key={key}><div><strong>{['图片','音频','视频'][i]}生成</strong><p>开启后，普通{['图片','音频','视频'][i]}生成会免二次确认</p></div><button role="switch" aria-label={`${['图片','音频','视频'][i]}生成`} aria-checked={confirmation[key]} className={confirmation[key]?'on':''} onClick={()=>setConfirmation(current=>({...current,[key]:!current[key]}))}><span/></button></div>)}</div></section><section aria-label="自动确认冷静期"><h3>自动确认冷静期</h3><div className="character-confirm-rows"><div className="character-confirm-row"><div><strong>自动确认前等待 10 秒</strong><p>开启后，免二次确认的生成任务会等待 10 秒，期间可点击「停止对话」尝试中止本次生成。</p></div><button role="switch" aria-label="自动确认前等待 10 秒" aria-checked={confirmation.cooldown} className={confirmation.cooldown?'on':''} onClick={()=>setConfirmation(current=>({...current,cooldown:!current.cooldown}))}><span/></button></div></div></section><div className="character-threshold"><div><strong>高积分强制确认阈值</strong><p>单次任务预估超过此值时，即使已选择不再提醒，仍会要求确认。无法预估积分的任务也会要求确认。</p></div><label><input type="number" aria-label="高积分强制确认阈值" min={1} max={100000} value={confirmation.threshold} onChange={e=>setConfirmation(current=>({...current,threshold:Number(e.target.value)}))}/>积分</label></div></div><footer><button onClick={()=>setConfirmSettings(false)}>取消</button><button className="primary" disabled={confirmation.threshold<1||Boolean(busy)} onClick={()=>{setBusy('保存设置');void save().then(ok=>ok&&command({action:'configure',settings:{confirmation}})).then(ok=>{if(ok)setConfirmSettings(false);}).finally(()=>setBusy(''));}}>保存</button></footer></Modal>}
  {pendingGenerate&&<Modal title="确认图片生成" className="character-generation-confirm" onClose={()=>setPendingGenerate(null)}><p>{item.name} · {labels[slot]} · {selectedModel}</p><p>本次生成将更新当前角色图片。所选数据源没有返回可用的积分预估，实际费用以提供方为准。</p><div className="modal-actions"><button className="button" onClick={()=>setPendingGenerate(null)}>取消</button><button className="button primary" onClick={()=>{const request=pendingGenerate;setPendingGenerate(null);void regenerate(request.instruction,request.references,true);}}>确认生成</button></div></Modal>}
  {assistant&&<Modal title="提示词优化" className="character-prompt-assistant" onClose={()=>setAssistant(false)}><div className="character-assistant-copy">{assistantResult||prompt}</div>{!assistantResult?<><strong>我们可以帮你...</strong><div className="character-assistant-options">{['扩写提示词','改写提示词'].map(mode=><button className={assistantMode===mode?'active':''} key={mode} onClick={()=>setAssistantMode(mode)}><Sparkles size={16}/>{mode}</button>)}</div><footer><input aria-label="优化方向（可选）" placeholder="直接发送，或描述你的想法" value={assistantNote} onChange={e=>setAssistantNote(e.target.value)}/><IconButton label="开始优化" disabled={!assistantMode||Boolean(busy)} onClick={()=>void transformPrompt(assistantMode,assistantNote).then(value=>value&&setAssistantResult(value))}>{busy?<LoaderCircle size={17} className="spin"/>:<ArrowUp size={17}/>}</IconButton></footer></>:<div className="modal-actions"><button className="button" onClick={()=>setAssistantResult('')}>重新优化</button><button className="button primary" onClick={()=>{changePrompt(assistantResult);setAssistant(false);}}>应用提示词</button></div>}</Modal>}
  {imageTool&&<InlineImageEditor name={imageTool} url={selectedUrl} rect={rect} crop={crop} onCrop={setCrop} ratio={cropRatio} onRatio={setCropRatio} rotation={rotation} onRotation={setRotation} flipped={flipped} onFlip={()=>setFlipped(!flipped)} verticalFlip={verticalFlip} onVerticalFlip={()=>setVerticalFlip(!verticalFlip)} busy={Boolean(busy)} onApply={()=>void applyImageTransform()} onClose={close}/>}

 </>;
}

export function ImageLightbox({url,onClose}:{url:string;onClose:()=>void}){
 const [zoom,setZoom]=useState(100);const [position,setPosition]=useState({x:0,y:0});const drag=useRef<{x:number;y:number;startX:number;startY:number}|null>(null);const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{const prior=document.activeElement as HTMLElement;box.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);prior?.focus();};},[onClose]);
 return <div ref={box} tabIndex={-1} className="character-image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={e=>{if(e.target===e.currentTarget)onClose();}} onWheel={e=>setZoom(current=>Math.max(25,Math.min(400,current+(e.deltaY<0?10:-10))))}>
  <IconButton className="character-preview-close" label="关闭图片预览" onClick={onClose}><X size={25}/></IconButton>
  <img src={url} alt="preview" draggable={false} style={{transform:`translate(${position.x}px,${position.y}px) scale(${zoom/100})`}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,startX:position.x,startY:position.y};}} onPointerMove={e=>{if(drag.current)setPosition({x:drag.current.startX+e.clientX-drag.current.x,y:drag.current.startY+e.clientY-drag.current.y});}} onPointerUp={()=>{drag.current=null;}}/>
  <div className="character-preview-zoom"><IconButton label="放大图片" disabled={zoom>=400} onClick={()=>setZoom(current=>Math.min(400,current+25))}><ZoomIn size={19}/></IconButton><button onClick={()=>{setZoom(100);setPosition({x:0,y:0});}}>{zoom}%</button><IconButton label="缩小图片" disabled={zoom<=25} onClick={()=>setZoom(current=>Math.max(25,current-25))}><ZoomOut size={19}/></IconButton></div>
 </div>;
}

function InlineImageEditor({name,url,rect,crop,onCrop,ratio,onRatio,rotation,onRotation,flipped,onFlip,verticalFlip,onVerticalFlip,busy,onApply,onClose}:{name:string;url:string;rect:Rect;crop:{x:number;y:number;w:number;h:number};onCrop:(value:{x:number;y:number;w:number;h:number})=>void;ratio:string;onRatio:(value:string)=>void;rotation:number;onRotation:(value:number)=>void;flipped:boolean;onFlip:()=>void;verticalFlip:boolean;onVerticalFlip:()=>void;busy:boolean;onApply:()=>void;onClose:()=>void}){
 const [menu,setMenu]=useState(false);const isCrop=name==='裁剪';
 const selectRatio=(value:string)=>{onRatio(value);setMenu(false);if(value==='自定义')return;const selected=value==='原始比例'?rect.width/rect.height:Number(value.split(':')[0])/Number(value.split(':')[1]);const w=Math.min(1,selected*rect.height/rect.width),h=Math.min(1,rect.width/rect.height/selected);onCrop({x:(1-w)/2,y:(1-h)/2,w,h});};
 const drag=(event:React.PointerEvent<HTMLElement>,corner='')=>{
  event.preventDefault();event.stopPropagation();const element=event.currentTarget;element.setPointerCapture(event.pointerId);const start={x:event.clientX,y:event.clientY},initial={...crop};
  const move=(e:PointerEvent)=>{const dx=(e.clientX-start.x)/rect.width,dy=(e.clientY-start.y)/rect.height;
   if(!corner){onCrop({...initial,x:Math.max(0,Math.min(1-initial.w,initial.x+dx)),y:Math.max(0,Math.min(1-initial.h,initial.y+dy))});return;}
   if(corner==='l'||corner==='r'){
    const right=corner==='r',anchor=right?initial.x:initial.x+initial.w,centerY=initial.y+initial.h/2,k=initial.w/initial.h;
    const limit=Math.min(right?1-anchor:anchor,ratio==='自定义'?1:2*Math.min(centerY,1-centerY)*k);
    const w=Math.max(.03,Math.min(limit,initial.w+dx*(right?1:-1))),h=ratio==='自定义'?initial.h:w/k;
    onCrop({x:right?anchor:anchor-w,y:centerY-h/2,w,h});return;
   }
   const right=corner.includes('r'),bottom=corner.includes('b'),ax=right?initial.x:initial.x+initial.w,ay=bottom?initial.y:initial.y+initial.h;
   let w=Math.max(.03,Math.min(right?1-ax:ax,initial.w+dx*(right?1:-1))),h=Math.max(.03,Math.min(bottom?1-ay:ay,initial.h+dy*(bottom?1:-1)));
   if(ratio!=='自定义'){const k=initial.w/initial.h,delta=Math.abs(dx)>Math.abs(dy)*k?dx*(right?1:-1):dy*(bottom?1:-1)*k;w=Math.max(.03,Math.min(right?1-ax:ax,(bottom?1-ay:ay)*k,initial.w+delta));h=w/k;}
   onCrop({x:right?ax:ax-w,y:bottom?ay:ay-h,w,h});
  };
  const done=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',done);element.removeEventListener('pointercancel',done);};element.addEventListener('pointermove',move);element.addEventListener('pointerup',done);element.addEventListener('pointercancel',done);
 };
 const barWidth=isCrop?300:382;const top=Math.min(window.innerHeight-65,rect.y+rect.height+12);
 return <div className="character-inline-editor">
  {isCrop?<div className="character-crop-overlay" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}><div className="character-crop-box" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.w*100}%`,height:`${crop.h*100}%`}} onPointerDown={e=>drag(e)}>{['tl','tr','bl','br'].map(corner=><span className={`crop-corner ${corner}`} key={corner} onPointerDown={e=>drag(e,corner)}/>)}<i className="crop-mid left" onPointerDown={e=>drag(e,'l')}/><i className="crop-mid right" onPointerDown={e=>drag(e,'r')}/></div></div>:<div className="character-transform-overlay" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}><img src={url} alt="旋转与镜像预览" style={{transform:`rotate(${rotation}deg) scale(${rotation%180!==0?Math.min(rect.width/rect.height,rect.height/rect.width):1}) scaleX(${flipped?-1:1}) scaleY(${verticalFlip?-1:1})`}}/></div>}
  <div className="character-image-toolbar inline-image-toolbar" style={{left:Math.max(16,rect.x+rect.width/2-barWidth/2),top,width:barWidth}}>
   <button onClick={onClose}><X size={17}/>{name}</button><span className="character-divider"/>
   {isCrop?<div className="character-toolbar-group"><button aria-expanded={menu} onClick={()=>setMenu(!menu)}><Crop size={17}/>{ratio}<ChevronDown size={12}/></button>{menu&&<div className="character-menu crop-ratio-menu">{['原始比例','自定义','1:1','2:3','3:4','16:9','9:16','3:2'].map(value=><button aria-pressed={value===ratio} key={value} onClick={()=>selectRatio(value)}>{value}{ratio===value&&<Check size={14}/>}</button>)}</div>}</div>:<><IconButton label="向左旋转 90°" onClick={()=>onRotation((rotation+270)%360)}><RotateCcw size={18}/></IconButton><IconButton label="向右旋转 90°" onClick={()=>onRotation((rotation+90)%360)}><RotateCw size={18}/></IconButton><IconButton label="水平镜像" aria-pressed={flipped} onClick={onFlip}><FlipHorizontal2 size={18}/></IconButton><IconButton label="垂直镜像" aria-pressed={verticalFlip} onClick={onVerticalFlip}><FlipVertical2 size={18}/></IconButton></>}
   <span className="character-divider"/><button className="image-tool-apply" disabled={busy||!isCrop&&!rotation&&!flipped&&!verticalFlip} onClick={onApply}>{busy?<LoaderCircle size={15} className="spin"/>:isCrop?'确定':'保存'}</button>
  </div>
 </div>;
}
