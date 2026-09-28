import express from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { createStore, newProject, splitScript } from './store.mjs';
import { extractWorkflow } from './workflow.mjs';
import { createProductionService, isProductionProject } from './production.mjs';
import { buildVideoRequest, videoDimensions } from './video-request.mjs';
import { buildChatMessages } from './chat-request.mjs';

const root=path.resolve(import.meta.dirname,'..');
const dataDir=process.env.DATA_DIR||path.join(root,'data');
const uploadDir=path.join(dataDir,'uploads');
const exportDir=path.join(dataDir,'exports');
await mkdir(uploadDir,{recursive:true});await mkdir(exportDir,{recursive:true});
const store=createStore(path.join(dataDir,'studio.sqlite'));
const app=express();
const port=Number(process.env.PORT||5173);
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.path.startsWith('/api')&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return res.status(403).json({error:'不允许跨站请求'});
  if(req.path.startsWith('/api')&&!['GET','HEAD'].includes(req.method)&&req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'不允许跨站请求'});
  next();
});
app.use(express.json({limit:'12mb'}));
app.use('/uploads',express.static(uploadDir,{setHeaders:(res)=>res.setHeader('Content-Security-Policy',"default-src 'none'; media-src 'self'; img-src 'self'")}));
app.use('/exports',express.static(exportDir));
const text=z.string().trim().min(1).max(160);
const mediaUrl=z.string().max(4000).refine(v=>v===''||/^\/(assets|uploads|exports)\/[\w./-]+$/.test(v)||/^https:\/\//.test(v),'素材地址不正确');
const agentKind=z.enum(['Agent','图文','视频','音频']);
const agentAdapter=z.enum(['generic','openai-chat','openai-image','openai-video']);
const agentModel=z.object({id:text,name:z.string().trim().min(1).max(100),description:z.string().max(300),badge:z.string().max(20).optional()});
const agentSourceCreate=z.object({kind:agentKind,name:text,endpoint:z.string().trim().url().max(2000),adapter:agentAdapter.default('generic'),apiKey:z.string().max(500).optional().default(''),enabled:z.boolean().default(true),defaultModel:z.string().max(100),models:z.array(agentModel).min(1).max(50)});
const agentSourcePatch=z.object({kind:agentKind.optional(),name:text.optional(),endpoint:z.string().trim().url().max(2000).optional(),adapter:agentAdapter.optional(),apiKey:z.string().max(500).optional(),enabled:z.boolean().optional(),defaultModel:z.string().max(100).optional(),models:z.array(agentModel).min(1).max(50).optional()});
const workflowMeta=z.record(z.string(),z.unknown()).optional();
const messageSchema=z.object({id:text,role:z.enum(['user','assistant','system']),text:z.string().max(50000),createdAt:z.string(),workflow:workflowMeta});
const nodeSchema=z.object({id:text,type:z.literal('studio'),position:z.object({x:z.number().finite(),y:z.number().finite()}),data:z.object({title:z.string().max(160),kind:z.string().max(40),text:z.string().max(50000),url:mediaUrl.optional(),mime:z.string().max(100).optional(),duration:z.number().min(.1).max(3600).optional(),color:z.string().max(20).optional(),model:z.string().max(100).optional(),style:z.string().max(1000).optional(),ratio:z.string().max(20).optional(),resolution:z.string().max(20).optional(),firstFrameUrl:mediaUrl.optional(),lastFrameUrl:mediaUrl.optional()}),selected:z.boolean().optional()});
const clipSchema=z.object({id:text,assetId:text.optional(),url:mediaUrl,title:z.string().max(160),mime:z.string().max(100),duration:z.number().min(.1).max(300),start:z.number().min(0).max(86400),muted:z.boolean()});
const projectPatch=z.object({name:text,category:z.string().max(60),cover:mediaUrl,favorite:z.boolean(),trashed:z.boolean(),folderId:z.string().nullable(),nodes:z.array(nodeSchema).max(1000),edges:z.array(z.object({id:text,source:text,target:text,type:z.string().optional(),animated:z.boolean().optional()})).max(2000),messages:z.array(messageSchema).max(2000),clips:z.array(clipSchema).max(100),script:z.string().max(200000)}).partial();
const validate=(schema,input)=>schema.parse(input);
const notFound=(res)=>res.status(404).json({error:'内容不存在'});
const providerInfo=()=>({configured:Boolean(process.env.GENERATION_ENDPOINT&&process.env.GENERATION_API_KEY),name:process.env.GENERATION_PROVIDER_NAME||'未配置生成服务'});
const publicAgentSource=source=>{const {apiKey,...safe}=source;return {...safe,adapter:source.adapter||'generic',apiKeyConfigured:Boolean(apiKey)};};

const adapterPaths={
 'openai-chat':'/chat/completions',
 'openai-image':'/images/generations',
 'openai-video':'/videos',
};
const endpointForAdapter=(endpoint,adapter)=>{
 const base=endpoint.replace(/\/+$/,'');
 const suffix=adapterPaths[adapter];
 return !suffix||base.endsWith(suffix)?base:`${base}${suffix}`;
};
const textFromValue=value=>{
 if(typeof value==='string')return value.trim();
 if(Array.isArray(value))return value.map(textFromValue).filter(Boolean).join('\n').trim();
 if(value&&typeof value==='object'){
  if(typeof value.text==='string')return value.text.trim();
  if(typeof value.content==='string')return value.content.trim();
 }
 return '';
};
const responseText=body=>textFromValue(body?.choices?.[0]?.message?.content||body?.choices?.[0]?.text||body?.output_text||body?.text||body?.message?.content||body?.output);
const responseMedia=body=>{
 const first=Array.isArray(body?.data)?body.data[0]:undefined;
 const candidates=[
  first?.url,first?.video_url,first?.video?.url,
  body?.video?.url,body?.video,body?.video_url,body?.output?.url,body?.output?.video_url,body?.output,
  body?.url,body?.images?.[0]?.url,body?.result?.url,body?.result?.video_url,body?.result,
 ];
 const url=candidates.find(value=>typeof value==='string'&&value.trim());
 if(url)return {url:url.trim()};
 const base64Candidates=[
  {value:first?.b64_json,mime:'image/png'},
  {value:first?.base64,mime:'image/png'},
  {value:body?.b64_json,mime:'image/png'},
  {value:body?.image_base64,mime:'image/png'},
  {value:body?.video_base64,mime:'video/mp4'},
 ];
 const encoded=base64Candidates.find(item=>typeof item.value==='string'&&item.value.trim());
 return encoded?{base64:encoded.value.trim(),mime:encoded.mime}:null;
};
const imageSize=(ratio,resolution)=>{
 const sizes={
  '16:9':{1:'1536x864',2:'1536x864',4:'2048x1152'},
  '9:16':{1:'864x1536',2:'864x1536',4:'1152x2048'},
  '1:1':{1:'1024x1024',2:'1536x1536',4:'2048x2048'},
  '4:3':{1:'1152x864',2:'1536x1152',4:'2048x1536'},
  '3:4':{1:'864x1152',2:'1152x1536',4:'1536x2048'},
 };
 const level=String(resolution||'2K').toUpperCase().replace('K','');
 return sizes[ratio]?.[level]||sizes['1:1'][2];
};
const promptWithContext=(input,settings)=>{
 const details=[];
 if(typeof settings.sourceTitle==='string'&&settings.sourceTitle.trim())details.push(`关联画布节点：${settings.sourceTitle.trim()}${typeof settings.sourceText==='string'&&settings.sourceText.trim()?`\n节点内容：${settings.sourceText.trim().slice(0,4000)}`:''}`);
 if(typeof settings.style==='string'&&settings.style.trim())details.push(`风格：${settings.style.trim()}`);
 if(typeof settings.skill==='string'&&settings.skill.trim())details.push(`技能要求：${settings.skill.trim()}`);
 return [input.prompt.trim(),...details].join('\n');
};
const workflowSystemPrompt=settings=>{
 const context=settings.canvasContext&&typeof settings.canvasContext==='object'?JSON.stringify(settings.canvasContext).slice(0,16000):'{}';
 return `你是 OiiOii 项目画布里的 Oii Agent，负责把用户的创作指令转成可继续执行的对话工作流。请使用中文。
只输出一个 JSON 对象，不要 Markdown，不要代码围栏，格式必须是：
{"reply":"给用户看的简短说明","actions":[{"type":"create_node","kind":"文本|剧本|角色|场景|分镜|图片|视频|音频","title":"节点标题","text":"节点内容","duration":5},{"type":"create_nodes","nodes":[{"kind":"分镜","title":"镜头 1","text":"镜头内容","duration":5}]},{"type":"replace_script","script":"完整剧本"},{"type":"split_storyboard","script":"按空行或场次拆分的剧本"},{"type":"focus","kind":"角色|场景|分镜"}],"quickReplies":["满意，请继续","我要修改"]}
没有需要改画布时 actions 返回空数组。只有在用户明确要求创作、整理、生成或拆分时才创建节点。若用户只是提问，就只返回 reply 和空 actions。
当前画布上下文：
${context}`;
};
const providerRequest=(input,provider)=>{
 const settings=input.settings||{};
 const model=input.model==='Agent'?(provider.defaultModel||input.model):input.model;
 const adapter=provider.adapter||'generic';
 if(adapter==='generic')return {url:provider.endpoint,model,body:input};
 if(adapter==='openai-chat')return {
  url:endpointForAdapter(provider.endpoint,adapter),
  model,
  body:{model,messages:buildChatMessages({prompt:promptWithContext(input,settings),systemPrompt:settings.workflow?workflowSystemPrompt(settings):'',references:settings.references||[],history:settings.history}),stream:false},
 };
 if(adapter==='openai-image'&&(settings.transparent||settings.quality&&settings.quality!=='标准'))throw new Error('当前图片接口尚未连接透明背景与质量参数，请选择标准质量、关闭透明背景，或使用支持这些设置的数据源。');
 if(adapter==='openai-image')return {
  url:endpointForAdapter(provider.endpoint,adapter),
  model,
  body:{model,prompt:promptWithContext(input,settings),n:1,...(model.startsWith('agnes-image-2.5')?{size:['1K','2K','3K','4K'].includes(settings.resolution)?settings.resolution:'2K',ratio:settings.ratio||'16:9'}:{size:imageSize(settings.ratio,settings.resolution)}),...(settings.references?.length?{extra_body:{image:settings.references,response_format:'url'}}:{})},
 };
 if(adapter==='openai-video')return {
  url:endpointForAdapter(provider.endpoint,adapter),
  model,
  body:buildVideoRequest(model,promptWithContext(input,settings),settings),
 };
 throw new Error(`不支持的数据源协议：${adapter}`);
};
const decodeBase64Media=async(base64,mime)=>{
 const raw=base64.replace(/^data:[^;]+;base64,/,'');
 const ext=mime==='video/mp4'?'mp4':mime==='audio/mpeg'?'mp3':'png';
 const filename=`generated-${randomUUID()}.${ext}`;
 await writeFile(path.join(uploadDir,filename),Buffer.from(raw,'base64'));
 return `/uploads/${filename}`;
};
const normalizeProviderResponse=async(body)=>{
 const rawText=responseText(body);
 const workflow=extractWorkflow(rawText);
 const text=workflow?.text||rawText;
 const media=responseMedia(body);
 const outputUrl=media?.url|| (media?.base64?await decodeBase64Media(media.base64,media.mime):undefined);
 if(!text&&!outputUrl)throw new Error('生成服务未返回可识别的文本或媒体结果');
 return {...(text?{text}:{}),...(workflow?.workflow?{workflow:workflow.workflow}:{}),...(outputUrl?{outputUrl}: {})};
};
const responseVideoId=body=>[body?.video_id,body?.data?.video_id,body?.video?.id].find(value=>typeof value==='string'&&value.trim());
const videoPollEndpoint=endpoint=>`${new URL(endpoint).origin}/agnesapi`;
const pollVideo=async(videoId,provider,signal,model='')=>{
 for(let attempt=0;attempt<150;attempt++){
  const response=await fetch(`${videoPollEndpoint(provider.endpoint)}?video_id=${encodeURIComponent(videoId)}${model?`&model_name=${encodeURIComponent(model)}`:''}`,{headers:{authorization:`Bearer ${provider.apiKey}`},signal});
  if(!response.ok)throw await providerError(response);
  const raw=await response.text();
  let body;try{body=JSON.parse(raw);}catch{body={text:raw};}
  const status=String(body?.status||body?.state||'').toLowerCase();
  if(['failed','error','cancelled','canceled'].includes(status))throw new Error(responseText(body)||body?.message||'视频生成失败');
  if(['succeeded','success','completed','done'].includes(status)||responseMedia(body))return normalizeProviderResponse(body);
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw new Error('视频生成超时，请检查 AgnesAI 任务状态');
};
const providerError=async(response)=>{
 const raw=await response.text();
 let body;
 try{body=JSON.parse(raw);}catch{}
 const message=responseText(body)||body?.error?.message||body?.message||(raw&&raw.slice(0,240));
 return new Error(`生成服务返回 HTTP ${response.status}${message?`：${message}`:''}`);
};
const encodeLocalReference=async url=>{
 if(!/^\/(assets|uploads|exports)\/[\w./-]+$/.test(url))return url;
 const base=url.startsWith('/assets/')?path.join(root,'public'):dataDir;
 const file=path.resolve(base,url.slice(1));
 if(!file.startsWith(path.resolve(base)+path.sep))throw new Error('参考素材路径不正确');
 const bytes=await readFile(file);
 const type=await fileTypeFromBuffer(bytes);
 if(!type?.mime.startsWith('image/'))throw new Error('首帧参考素材不是图片');
 return `data:${type.mime};base64,${bytes.toString('base64')}`;
};
const publicReference=url=>{
 if(/^https:\/\//.test(url))return url;
 const origin=store.get('media-origin',url)?.sourceUrl;if(origin)return origin;
 const base=process.env.GENERATION_MEDIA_BASE_URL;
 if(base&&/^https:\/\//.test(base)&&/^\/(assets|uploads|exports)\/[\w./-]+$/.test(url))return new URL(url.slice(1),base.replace(/\/?$/,'/')).href;
 throw new Error('视频参考图仅保存在本机。Agnes Video 2.5 需要公开 HTTPS 地址，请配置 GENERATION_MEDIA_BASE_URL 或接入支持本机图片的模型。');
};
const resolveGenerationSettings=async(kind,model,settings={})=>{
 const resolve=kind==='视频'&&model.startsWith('agnes-video-2.5')?publicReference:encodeLocalReference;
 return {...settings,firstFrameUrl:settings.firstFrameUrl?await resolve(settings.firstFrameUrl):'',lastFrameUrl:settings.lastFrameUrl?await resolve(settings.lastFrameUrl):'',references:await Promise.all((settings.references||[]).map(resolve))};
};
const cacheProductionMedia=async(outputUrl,kind,signal)=>{
 if(!/^https:\/\//.test(outputUrl))return outputUrl;
 const parsed=new URL(outputUrl);
 if(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname))throw new Error('生成结果地址不可访问');
 const response=await fetch(outputUrl,{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
 if(!response.ok||!response.body)throw new Error(`下载生成结果失败：HTTP ${response.status}`);
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>180*1024*1024)throw new Error('生成结果超过 180MB 限制');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);const detected=await fileTypeFromBuffer(bytes);
 const expected=kind==='视频'?'video/':kind==='音频'?'audio/':'image/';
 if(!detected?.mime.startsWith(expected))throw new Error('生成服务返回的媒体类型不正确');
 const file=`generated-${randomUUID()}.${detected.ext}`;await writeFile(path.join(uploadDir,file),bytes);
 const localUrl=`/uploads/${file}`;store.put('media-origin',{id:localUrl,sourceUrl:outputUrl});
 return localUrl;
};
const productionGenerate=async({kind,prompt,model,settings,signal})=>{
 const sourceKind=kind==='图片'?'图文':kind;
 const source=store.list('agent-source').find(s=>s.enabled&&s.kind===sourceKind&&s.apiKey&&(!model||s.models.some(m=>m.name===model)));
 if(!source)throw new Error(`未配置可用的${sourceKind}数据源${model?`（${model}）`:''}，请在全局 Agent 配置中设置后重试。`);
 const resolved=await resolveGenerationSettings(kind,model||source.defaultModel,settings);
 const request=providerRequest({kind,prompt,model:model||source.defaultModel,settings:resolved},source);
 const combined=AbortSignal.any([signal,AbortSignal.timeout(kind==='视频'?900000:180000)]);
 const response=await fetch(request.url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${source.apiKey}`},body:JSON.stringify(request.body),signal:combined});
 if(!response.ok)throw await providerError(response);
 const body=await response.json();
 // Stage schemas consume the provider text directly, never legacy canvas actions.
 if(kind==='Agent')return {text:responseText(body)};
 const out=source.adapter==='openai-video'&&responseVideoId(body)?await pollVideo(responseVideoId(body),source,combined,request.model):await normalizeProviderResponse(body);
 return out.outputUrl?{...out,outputUrl:await cacheProductionMedia(out.outputUrl,kind,combined)}:out;
};
const hasAudioStream=file=>new Promise((resolve,reject)=>{
 let stderr='';const child=spawn(ffmpeg,['-i',file],{stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
 child.on('error',reject);child.on('exit',()=>resolve(/Stream #\d+:\d+[^\n]*Audio:/i.test(stderr)));
});
const production=createProductionService({store,generate:productionGenerate,compose:async(p,signal)=>{
 const shots=p.shots.filter(s=>s.videoUrl);
 if(!shots.length)throw new Error('没有可合成的分镜视频。');
 const localFile=async(url,kind)=>{
  const local=await cacheProductionMedia(url,kind,signal);
  if(!/^\/(uploads|exports)\/[\w./-]+$/.test(local))throw new Error('合成素材地址不正确');
  const file=path.join(dataDir,local.slice(1));
  if(!existsSync(file))throw new Error('合成素材文件不存在');
  return file;
 };
 const inputs=await Promise.all(shots.map(async s=>({file:await localFile(s.videoUrl,'视频'),audio:s.audioUrl?await localFile(s.audioUrl,'音频'):null,duration:s.duration||5})));
 const music=p.musicUrl?await localFile(p.musicUrl,'音频'):null;
 const {width,height}=videoDimensions(p.settings.ratio||'16:9',p.settings.resolution||'720p');
 const id=randomUUID();const work=path.join(exportDir,id);await mkdir(work,{recursive:true});
 try{
  for(let i=0;i<inputs.length;i++){
   const input=inputs[i];const embedded=input.audio?false:await hasAudioStream(input.file);
   const audioArgs=input.audio?['-i',input.audio]:embedded?[]:['-f','lavfi','-i','anullsrc=r=48000:cl=stereo'];
   await run(['-y','-i',input.file,...audioArgs,'-t',String(input.duration),'-map','0:v:0','-map',input.audio||!embedded?'1:a:0':'0:a:0','-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${input.duration}`,'-af','apad','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2',path.join(work,`${i}.mp4`)],signal);
  }
  await writeFile(path.join(work,'list.txt'),inputs.map((_,i)=>`file '${i}.mp4'`).join('\n'));
  const output=path.join(exportDir,`${id}.mp4`);
  const background=path.join(work,'background.m4a');
  if(music)await run(['-y','-stream_loop','-1','-i',music,'-t',String(inputs.reduce((total,input)=>total+input.duration,0)),'-c:a','aac',background],signal);
  await run(['-y','-f','concat','-safe','0','-i',path.join(work,'list.txt'),...(music?['-i',background,'-filter_complex','[1:a]volume=0.23[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-shortest']:['-c','copy']),'-movflags','+faststart',output],signal);
  return {outputUrl:`/exports/${id}.mp4`};
 }finally{await rm(work,{recursive:true,force:true});}
}});
app.get('/api/projects/:id/production',(req,res)=>{
 const project=store.get('project',req.params.id);
 if(!project)return notFound(res);
 if(!isProductionProject(project))return res.status(404).json({error:'自由画布项目不使用制作工作流'});
 res.json({production:production.get(req.params.id),stages:production.stages});
});
app.post('/api/projects/:id/production/commands',(req,res)=>{
 const input=validate(z.object({version:z.number().int().min(0),action:z.enum(['start','continue','revise','retry','skip','stop','edit','replace_asset','configure','recompose']),prompt:z.string().max(50000).optional(),mode:z.enum(['one','all']).optional(),targetIds:z.array(text).max(100).optional(),targetNumbers:z.array(z.number().int().min(1).max(100)).max(100).optional(),targetId:text.optional(),assetSlot:z.string().max(40).optional(),assetUrl:mediaUrl.optional(),assetSettings:z.record(z.string(),z.unknown()).optional(),assetReferences:z.array(mediaUrl).max(10).optional(),changes:z.record(z.string(),z.string().max(12000)).optional(),settings:z.object({style:z.string().max(1000).optional(),skill:z.string().max(1000).optional(),ratio:z.string().max(20).optional(),resolution:z.string().max(20).optional(),duration:z.number().min(1).max(30).optional(),separateShotAudio:z.boolean().optional(),confirmation:z.object({image:z.boolean(),audio:z.boolean(),video:z.boolean(),cooldown:z.boolean(),threshold:z.number().int().min(1).max(100000)}).optional(),models:z.record(z.string(),z.string().max(100)).optional()}).optional()}),req.body);
 try{res.status(202).json(production.command(req.params.id,input));}catch(e){res.status(e.status||500).json({error:e.message});}
});
app.post('/api/projects/:id/production/assets/generate',(req,res)=>{
 if(!store.get('project',req.params.id))return notFound(res);
 const input=validate(z.object({version:z.number().int().min(0),targetId:text,assetSlot:z.enum(['imageUrl','turnaroundUrl','expressionUrl']),model:z.string().min(1).max(100),prompt:z.string().trim().min(1).max(12000).optional(),references:z.array(mediaUrl).max(10).optional()}),req.body);
 res.status(202).json(production.generateAsset(req.params.id,input));
});
if(!store.get('profile','local')) store.put('profile',{id:'local',name:'本地创作者',avatar:'/assets/avatar.jpg',checkedIn:null,credits:0});
if(!store.get('notification','welcome'))store.put('notification',{id:'welcome',title:'本地工作室已就绪',text:'项目与素材保存在本机。生成服务尚未配置，原站账户和余额不会被调用。',read:false});

app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/bootstrap',(req,res)=>res.json({projects:store.list('project'),assets:store.list('asset'),skills:store.list('skill'),jobs:store.list('job'),folders:store.list('folder'),favorites:store.list('favorite').map(v=>v.id),profile:store.get('profile','local'),works:store.list('work'),provider:providerInfo(),agentSources:store.list('agent-source').map(publicAgentSource),notifications:store.list('notification')}));
app.get('/api/agent-sources',(req,res)=>res.json(store.list('agent-source').map(publicAgentSource)));
app.post('/api/agent-sources',(req,res)=>{const input=validate(agentSourceCreate,req.body);const source={id:randomUUID(),...input,updatedAt:new Date().toISOString()};res.status(201).json(publicAgentSource(store.put('agent-source',source)));});
app.patch('/api/agent-sources/:id',(req,res)=>{const input=validate(agentSourcePatch,req.body);const old=store.get('agent-source',req.params.id);if(!old)return notFound(res);const next={...old,...input,id:old.id,apiKey:input.apiKey?.trim()?input.apiKey:old.apiKey,updatedAt:new Date().toISOString()};res.json(publicAgentSource(store.put('agent-source',next)));});
app.delete('/api/agent-sources/:id',(req,res)=>{if(!store.get('agent-source',req.params.id))return notFound(res);store.remove('agent-source',req.params.id);res.json({ok:true});});
app.post('/api/projects',(req,res)=>res.status(201).json(store.put('project',newProject(validate(z.object({name:text.optional(),category:z.string().max(60).optional()}),req.body)))));
app.get('/api/projects/:id',(req,res)=>{const p=store.get('project',req.params.id);p?res.json(p):notFound(res);});
app.patch('/api/projects/:id',(req,res)=>{const result=store.update('project',req.params.id,validate(projectPatch,req.body));result?res.json(result):notFound(res);});
app.post('/api/projects/:id/duplicate',(req,res)=>{const p=store.get('project',req.params.id);if(!p)return notFound(res);const n=newProject();res.status(201).json(store.put('project',{...p,id:n.id,name:`${p.name} 副本`,createdAt:n.createdAt,updatedAt:n.updatedAt,trashed:false}));});
app.delete('/api/projects/:id',(req,res)=>{const p=store.get('project',req.params.id);if(!p)return notFound(res);if(!p.trashed)return res.status(409).json({error:'请先将项目移入回收站'});store.remove('project',p.id);res.json({ok:true});});
app.post('/api/projects/import',(req,res)=>{const data=validate(projectPatch,req.body);res.status(201).json(store.put('project',newProject({...data,trashed:false})));});
app.post('/api/projects/:id/storyboard',(req,res)=>{const p=store.get('project',req.params.id);if(!p)return notFound(res);const {script}=validate(z.object({script:z.string().min(1).max(200000)}),req.body);const nodes=splitScript(script);const edges=nodes.slice(1).map((n,i)=>({id:randomUUID(),source:nodes[i].id,target:n.id}));res.json(store.update('project',p.id,{script,nodes:[...p.nodes,...nodes],edges:[...p.edges,...edges]}));});
app.post('/api/folders',(req,res)=>res.status(201).json(store.put('folder',{id:randomUUID(),...validate(z.object({name:text}),req.body)})));
app.post('/api/favorites/:id',(req,res)=>{const id=req.params.id;if(store.get('favorite',id))store.remove('favorite',id);else store.put('favorite',{id});res.json({favorites:store.list('favorite').map(v=>v.id)});});
app.patch('/api/profile',(req,res)=>res.json(store.update('profile','local',validate(z.object({name:text}),req.body))));
app.post('/api/checkin',(req,res)=>{const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});const p=store.get('profile','local');res.json(store.update('profile','local',{checkedIn:date,credits:p.checkedIn===date?p.credits:p.credits+10}));});
app.post('/api/notifications/read',(req,res)=>{store.list('notification').forEach(n=>store.update('notification',n.id,{read:true}));res.json({ok:true});});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024,files:20}});
app.post('/api/assets/upload',upload.array('files',20),async(req,res)=>{
  if(!req.files?.length)return res.status(400).json({error:'请选择文件'});
  const category=validate(z.enum(['角色','场景','道具','合集','其他']),req.body.category||'其他');
  const checked=[];
  for(const file of req.files){
    const type=await fileTypeFromBuffer(file.buffer);
    if(!type||!['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/ogg'].includes(type.mime))return res.status(400).json({error:`不支持的文件类型：${file.originalname}`});
    checked.push({file,type});
  }
  const assets=[];
  for(const {file,type} of checked){const id=randomUUID();const filename=`${id}.${type.ext}`;await writeFile(path.join(uploadDir,filename),file.buffer);const name=Buffer.from(file.originalname,'latin1').toString('utf8');assets.push(store.put('asset',{id,name:name.includes('\uFFFD')?file.originalname:name,category,url:`/uploads/${filename}`,mime:type.mime,size:file.size,favorite:false,trashed:false,createdAt:new Date().toISOString(),description:''}));}
  res.status(201).json({assets});
});
app.patch('/api/assets/:id',(req,res)=>{const value=store.update('asset',req.params.id,validate(z.object({name:text,category:z.enum(['角色','场景','道具','合集','其他']),favorite:z.boolean(),trashed:z.boolean(),description:z.string().max(10000)}).partial(),req.body));value?res.json(value):notFound(res);});
app.delete('/api/assets/:id',async(req,res)=>{const a=store.get('asset',req.params.id);if(!a)return notFound(res);if(!a.trashed)return res.status(409).json({error:'请先将资产移入回收站'});store.remove('asset',a.id);await rm(path.join(uploadDir,path.basename(a.url)),{force:true});res.json({ok:true});});
app.post('/api/skills',(req,res)=>{const s=validate(z.object({name:text,description:z.string().max(500),instructions:z.string().min(1).max(50000),category:z.string().max(40),image:mediaUrl.optional()}),req.body);res.status(201).json(store.put('skill',{id:randomUUID(),...s,image:s.image||'/assets/skill-0.jpg',custom:true}));});
app.patch('/api/skills/:id',(req,res)=>{const value=store.update('skill',req.params.id,validate(z.object({name:text,description:z.string().max(500),instructions:z.string().min(1).max(50000),category:z.string().max(40)}).partial(),req.body));value?res.json(value):notFound(res);});
app.delete('/api/skills/:id',(req,res)=>{store.remove('skill',req.params.id);res.json({ok:true});});
app.post('/api/works',(req,res)=>{const w=validate(z.object({title:text,description:z.string().max(3000),category:z.string().max(40),video:mediaUrl,image:mediaUrl}),req.body);if(!w.video.startsWith('/uploads/')&&!w.video.startsWith('/exports/'))return res.status(400).json({error:'请选择本地视频素材'});res.status(201).json(store.put('work',{id:randomUUID(),...w,local:true}));});

const controllers=new Map();
store.list('job').filter(j=>['running','queued'].includes(j.status)).forEach(j=>store.update('job',j.id,{status:'failed',error:'服务重启，任务已中断；可重新提交。'}));
app.post('/api/generate',async(req,res)=>{
 const input=validate(z.object({projectId:text,prompt:z.string().trim().min(1).max(50000),model:z.string().max(100),kind:z.enum(['Agent','图片','视频','音频']),settings:z.record(z.string(),z.unknown()).optional()}),req.body);
 if(!store.get('project',input.projectId))return notFound(res);
 const sourceKind=input.kind==='图片'?'图文':input.kind;
 const dynamicSource=store.list('agent-source').find(source=>source.enabled&&source.kind===sourceKind&&source.endpoint&&source.apiKey&&(input.model==='Agent'||!source.models.length||source.models.some(model=>model.name===input.model)));
 const provider=dynamicSource?{configured:true,endpoint:dynamicSource.endpoint,apiKey:dynamicSource.apiKey,name:dynamicSource.name,adapter:dynamicSource.adapter||'generic',defaultModel:dynamicSource.defaultModel}:providerInfo().configured?{configured:true,endpoint:process.env.GENERATION_ENDPOINT,apiKey:process.env.GENERATION_API_KEY,name:providerInfo().name,adapter:'generic'}:{configured:false,name:'未配置生成服务',adapter:'generic'};
 const id=randomUUID();const configured=provider.configured;const model=input.model==='Agent'?provider.defaultModel||input.model:input.model;
 const job=store.put('job',{id,...input,model,status:configured?'running':'blocked',createdAt:new Date().toISOString(),...(configured?{}:{error:'尚未配置生成服务。请在全局 Agent 配置或 .env 中设置生成服务。'})});
 res.status(202).json(job);
 if(!configured)return;
 const controller=new AbortController();controllers.set(id,controller);const timeout=setTimeout(()=>controller.abort(),input.kind==='视频'?900000:180000);
 try{
   const settings=await resolveGenerationSettings(input.kind,model,input.settings);
   const request=providerRequest({...input,model,settings},provider);
   const response=await fetch(request.url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${provider.apiKey}`},body:JSON.stringify(request.body),signal:controller.signal});
   if(!response.ok)throw await providerError(response);
   const raw=await response.text();
   let body;try{body=JSON.parse(raw);}catch{body={text:raw};}
   const out=provider.adapter==='openai-video'
    ?await (responseVideoId(body)?pollVideo(responseVideoId(body),provider,controller.signal,request.model):normalizeProviderResponse(body))
    :await normalizeProviderResponse(body);
   if(out.outputUrl&&input.kind!=='Agent')out.outputUrl=await cacheProductionMedia(out.outputUrl,input.kind,controller.signal);
   if(store.get('job',id)?.status!=='cancelled')store.update('job',id,{status:'completed',...out});
 }catch(e){if(store.get('job',id)?.status!=='cancelled')store.update('job',id,{status:'failed',error:e.name==='AbortError'?'生成超时，请检查服务状态':e.message});}
 finally{clearTimeout(timeout);controllers.delete(id);}
});
app.get('/api/jobs/:id',(req,res)=>{const j=store.get('job',req.params.id);j?res.json(j):notFound(res);});
app.post('/api/jobs/:id/cancel',(req,res)=>{const j=store.get('job',req.params.id);if(!j)return notFound(res);if(['completed','failed','cancelled'].includes(j.status))return res.json(j);controllers.get(j.id)?.abort();res.json(store.update('job',j.id,{status:'cancelled'}));});

const run=(args,signal)=>new Promise((resolve,reject)=>{let stderr='';const p=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe'],signal});p.stderr.on('data',c=>{stderr=(stderr+c).slice(-3000);});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`视频导出失败：${stderr.slice(-300)}`)));});
let exporting=false;
app.post('/api/projects/:id/export',async(req,res)=>{
 const p=store.get('project',req.params.id);if(!p)return notFound(res);
 const {width,height}=validate(z.object({width:z.union([z.literal(1280),z.literal(720)]).default(1280),height:z.union([z.literal(720),z.literal(1280)]).default(720)}),req.body);
 if(!p.clips.length)return res.status(400).json({error:'时间线暂无片段'});
 if(exporting)return res.status(409).json({error:'另一个导出正在进行，请稍后重试'});
 if(!ffmpeg||!existsSync(ffmpeg))return res.status(503).json({error:'本机 FFmpeg 尚未安装'});
 exporting=true;const id=randomUUID();const work=path.join(exportDir,id);await mkdir(work,{recursive:true});
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),180000);
 try{
  for(let i=0;i<p.clips.length;i++){
   const c=validate(clipSchema,p.clips[i]);const a=store.list('asset').find(a=>a.url===c.url&&!a.trashed);
   if(!a)throw new Error('导出仅支持已上传且未删除的本地素材');
   if(!a.mime.startsWith('video/')&&!a.mime.startsWith('image/'))throw new Error('画面轨道仅支持图片或视频');
   const file=path.join(uploadDir,path.basename(a.url));
   const args=['-y',...(a.mime.startsWith('image/')?['-loop','1']:['-ss',String(c.start)]),'-i',file,'-t',String(c.duration),'-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`,'-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',path.join(work,`${i}.mp4`)];
   await run(args,controller.signal);
  }
  await writeFile(path.join(work,'list.txt'),p.clips.map((_,i)=>`file '${i}.mp4'`).join('\n'));
  await run(['-y','-f','concat','-safe','0','-i',path.join(work,'list.txt'),'-c','copy','-movflags','+faststart',path.join(exportDir,`${id}.mp4`)],controller.signal);
  res.json({url:`/exports/${id}.mp4`,note:'当前导出为无声画面合成'});
 }catch(e){res.status(400).json({error:e.message});}
 finally{exporting=false;clearTimeout(timeout);await rm(work,{recursive:true,force:true});}
});
app.use('/api',(req,res)=>notFound(res));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err instanceof z.ZodError||err instanceof multer.MulterError?400:500).json({error:err instanceof z.ZodError?'数据格式不正确，请检查输入':err.message||'服务器错误'});});
if(process.env.NODE_ENV==='production'){
 app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}else{
 const {createServer}=await import('vite');const vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);
}
const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Studio ready: http://localhost:${port}`));
server.on('error',err=>{console.error(err.message);process.exit(1);});
