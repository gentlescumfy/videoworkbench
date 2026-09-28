import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const stages = [
  { id:'script', title:'剧本', agent:'编剧', kind:'Agent' },
  { id:'design', title:'角色与场景设定', agent:'艺术总监', kind:'Agent' },
  { id:'design_images', title:'角色与场景图片', agent:'角色 / 场景设计师', kind:'图片' },
  { id:'storyboard', title:'分镜与图提示词', agent:'分镜师', kind:'Agent' },
  { id:'storyboard_images', title:'分镜图片', agent:'分镜师', kind:'图片' },
  { id:'video_prompts', title:'视频、音效与台词', agent:'分镜师', kind:'Agent' },
  { id:'videos', title:'分镜视频', agent:'分镜师', kind:'视频' },
  { id:'shot_audio', title:'镜头音效与配音', agent:'音效总监', kind:'音频' },
  { id:'music', title:'背景音乐', agent:'音效总监', kind:'音频' },
  { id:'compose', title:'最终合成', agent:'艺术总监', kind:'compose' },
];
export const isProductionProject = project => Boolean(project && project.category !== '自由画布');
const short=z.string().trim().min(1).max(160);
const content=z.string().trim().min(1).max(12000);
const design=z.object({name:short,description:content,imagePrompt:content});
const schemas={
  script:z.object({title:short,script:z.string().trim().min(1).max(50000)}),
  design:z.object({characters:z.array(design).min(1).max(30),scenes:z.array(design).min(1).max(30)}),
  storyboard:z.object({shots:z.array(z.object({title:short,description:content,imagePrompt:content,characterIds:z.array(short).max(20),sceneId:short,duration:z.number().min(1).max(30)})).min(1).max(100)}),
  video_prompts:z.object({shots:z.array(z.object({id:short,videoPrompt:content,audioPrompt:z.string().max(12000),dialogue:z.string().max(12000)})).min(1).max(100)}),
};
export function parseProductionOutput(stage,text) {
  const raw=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return schemas[stage].parse(JSON.parse(raw)); }
  catch { throw new Error('模型未返回完整的阶段数据，请重试；当前成果未被替换。'); }
}
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();
const event=(p,text,role='assistant')=>p.events.push({id:randomUUID(),role,text,stage:p.stage,agent:stages.find(s=>s.id===p.stage)?.agent||'Oii Agent',createdAt:now()});
export function newProduction(id) {
  return {id,version:0,stage:'script',status:'idle',brief:'',settings:{},script:'',title:'',characters:[],scenes:[],shots:[],tasks:[],events:[],musicUrl:'',outputUrl:'',skipped:[]};
}
function instruction(p,stage,note) {
  const formats={
    script:'{"title":"片名","script":"完整剧本，含分场、动作和对白"}',
    design:'{"characters":[{"name":"角色名","description":"人物设定","imagePrompt":"角色主图提示词"}],"scenes":[{"name":"场景名","description":"场景设定","imagePrompt":"场景主图提示词"}]}',
    storyboard:'{"shots":[{"title":"镜头标题","description":"画面内容","imagePrompt":"图提示词","characterIds":["必须使用上下文角色id"],"sceneId":"必须使用上下文场景id","duration":5}]}',
    video_prompts:'{"shots":[{"id":"必须使用原镜头id","videoPrompt":"按时间段描述运镜与动作","audioPrompt":"环境音效","dialogue":"逐字对白，没有对白则留空"}]}',
  };
  // Context is structured before serialization; no truncation through JSON boundaries.
  return `你是${stages.find(s=>s.id===stage).agent}。只完成当前阶段：${stages.find(s=>s.id===stage).title}。输出中文 JSON，不要代码围栏。
格式：${formats[stage]}
不要调用工具，不要声称图片或视频已生成，不要擅自推进下一阶段。必须遵循用户要求的风格、语言、片长和镜头数量；保持角色、场景和镜头引用一致。
用户本次要求：${note||'按已确认内容继续'}
项目资料：${JSON.stringify({brief:p.brief,settings:p.settings,script:p.script,characters:p.characters.map(({id,name,description})=>({id,name,description})),scenes:p.scenes.map(({id,name,description})=>({id,name,description})),shots:stage==='video_prompts'?p.shots.map(({id,title,description,duration,characterIds,sceneId})=>({id,title,description,duration,characterIds,sceneId})):[]})}`;
}
function applyText(p,stage,out) {
  if(stage==='script'){p.title=out.title;p.script=out.script;}
  if(stage==='design'){
    p.characters=out.characters.map(x=>({...x,id:randomUUID()}));
    p.scenes=out.scenes.map(x=>({...x,id:randomUUID()}));
  }
  if(stage==='storyboard'){
    for(const shot of out.shots){
      if(!p.scenes.some(x=>x.id===shot.sceneId)||shot.characterIds.some(id=>!p.characters.some(x=>x.id===id)))throw new Error('分镜引用了不存在的角色或场景，未写入结果。');
    }
    p.shots=out.shots.map((x,i)=>({...x,id:randomUUID(),number:i+1}));
  }
  if(stage==='video_prompts'){
    const ids=new Set(out.shots.map(x=>x.id));
    if(ids.size!==p.shots.length||out.shots.length!==p.shots.length||p.shots.some(x=>!ids.has(x.id)))throw new Error('视频提示词未覆盖全部镜头，未写入结果。');
    p.shots=p.shots.map(shot=>({...shot,...out.shots.find(x=>x.id===shot.id)}));
  }
}
export function videoReferencePlan(p,shot){
 const ordered=new Map();let error='';
 for(const match of (shot.videoPrompt||'').matchAll(/@图\s*(\d+)\s*[（(]([^）)]+)[）)]/g)){
  const number=Number(match[1]);if(number===1)continue;
  const item=[...p.characters,...p.scenes].find(item=>match[2].includes(item.name));
  if(!item?.imageUrl){error=`视频提示词的 @图${number}（${match[2]}）没有对应参考图，请补齐后生成。`;continue;}
  if(ordered.has(number)&&ordered.get(number).id!==item.id)error=`视频提示词的 @图${number} 指向不同素材，请修正。`;
  ordered.set(number,item);
 }
 // Some original prompts omit a visual mention but retain that numbered
 // character in the ordered voice-style list (e.g. shot 18's elder).
 const voices=[...(shot.videoPrompt||'').matchAll(/"character"\s*:\s*"([^"\n]+)"/g)].map(match=>p.characters.find(item=>item.name===match[1])).filter(Boolean);
 const maxNumber=Math.max(1,...ordered.keys());
 for(let number=2;number<=maxNumber;number++)if(!ordered.has(number)){
  const item=voices[number-2];if(item?.imageUrl&&![...ordered.values()].some(x=>x.id===item.id))ordered.set(number,item);
 }
 const numbered=[...ordered].sort(([a],[b])=>a-b);
 if(!error&&numbered.some(([number],index)=>number!==index+2))error='视频提示词的参考图编号不连续，请按分镜图为 @图1、角色与场景图为 @图2 起排列。';
 const items=numbered.map(([,item])=>item);
 for(const item of numbered.length?[]:[...(shot.characterIds||[]).map(id=>p.characters.find(c=>c.id===id)),p.scenes.find(s=>s.id===shot.sceneId)]){
  if(item?.imageUrl&&!items.some(x=>x.id===item.id))items.push(item);
 }
 return {firstFrameUrl:shot.imageUrl||'',references:items.map(x=>x.imageUrl),referenceLabels:['分镜关键帧',...items.map(x=>x.name)],referenceError:error};
}
function targets(p,stage) {
  if(stage==='design_images')return [
    ...p.characters.flatMap(x=>[
      {id:x.id,key:`${x.id}:imageUrl`,title:`${x.name} · 选角`,slot:'imageUrl',prompt:x.imagePrompt,entity:'character'},
      {id:x.id,key:`${x.id}:turnaroundUrl`,title:`${x.name} · 三视图`,slot:'turnaroundUrl',prompt:x.turnaroundPrompt||`${x.imagePrompt}\n生成同一角色的正面、侧面、背面三视图，保持五官与服装一致。`,entity:'character'},
      {id:x.id,key:`${x.id}:expressionUrl`,title:`${x.name} · 表情图`,slot:'expressionUrl',prompt:x.expressionPrompt||`${x.imagePrompt}\n生成同一角色的多种表情图，保持五官与服装一致。`,entity:'character'},
    ].filter(target=>!x.imageSlots||x.imageSlots.includes(target.slot))),
    ...p.scenes.flatMap(x=>[
      {id:x.id,key:`${x.id}:imageUrl`,title:`${x.name} · 主图`,slot:'imageUrl',prompt:x.imagePrompt,entity:'scene'},
      {id:x.id,key:`${x.id}:multiviewUrl`,title:`${x.name} · 多视角`,slot:'multiviewUrl',prompt:x.multiviewPrompt||`${x.imagePrompt}\n同一场景的多视角构图，保持环境细节一致。`,entity:'scene'},
    ]),
  ];
  if(stage==='storyboard_images')return p.shots.map(x=>({id:x.id,number:x.number,title:`分镜 ${x.number}`,slot:'imageUrl',prompt:x.imagePrompt,entity:'shot',references:[...(x.characterIds||[]).map(id=>p.characters.find(c=>c.id===id)?.imageUrl),p.scenes.find(s=>s.id===x.sceneId)?.imageUrl].filter(Boolean)}));
  if(stage==='videos')return p.shots.map(x=>({id:x.id,number:x.number,title:`分镜 ${x.number}`,slot:'videoUrl',prompt:[x.videoPrompt,`音效：${x.audioPrompt||'无'}`,`台词：${x.dialogue||'无对白'}`].join('\n'),entity:'shot',duration:x.duration,...videoReferencePlan(p,x)}));
  if(stage==='shot_audio')return p.shots.map(x=>({id:x.id,number:x.number,title:`镜头 ${x.number} 音效与配音`,slot:'audioUrl',prompt:[`为这个 ${x.duration||5} 秒的镜头生成音频。`,x.audioPrompt||'无环境音效',x.dialogue?`中文对白：${x.dialogue}`:'无对白'].join('\n'),entity:'shot',duration:x.duration}));
  if(stage==='music')return [{id:p.id,title:'全片背景音乐',slot:'musicUrl',prompt:`为短片生成无对白背景音乐。${p.brief}\n${p.script.slice(0,8000)}`,entity:'production'}];
  return [];
}
function entity(p,target) {
  return target.entity==='production'?p:({character:p.characters,scene:p.scenes,shot:p.shots}[target.entity]||[]).find(x=>x.id===target.id);
}
function pending(p,stage) {
  return targets(p,stage).filter(t=>!entity(p,t)?.[t.slot]&&!p.skipped.includes(`${stage}:${t.key||t.id}`));
}
function invalidate(p,stage) {
  const index=stages.findIndex(s=>s.id===stage);
  p.skipped=p.skipped.filter(key=>stages.findIndex(s=>key.startsWith(`${s.id}:`))<index);
  if(index<=1){p.characters=[];p.scenes=[];}
  if(index<=3)p.shots=[];
  if(index===5)p.shots=p.shots.map(({videoUrl,audioUrl,videoPrompt,audioPrompt,dialogue,...s})=>s);
  if(index<=8)p.musicUrl='';
  p.outputUrl='';
}
export function createProductionService({store,generate,compose}) {
  const active=new Map();
  const assetRuns=new Map();
  const get=id=>store.get('production',id)||newProduction(id);
  const put=p=>{p.version++;p.updatedAt=now();return store.put('production',p);};
  // Restart never resubmits billable provider requests automatically.
  for(const p of store.list('production')){
    if(p.status==='running'||p.tasks.some(t=>t.assetEdit&&['running','queued'].includes(t.status))){
      p.tasks.filter(t=>['running','queued'].includes(t.status)).forEach(t=>{t.status='failed';t.error='服务重启，任务中断。请确认后重试。';t.finishedAt=now();});
      if(p.status==='running')p.status='partial';event(p,'服务重启，制作已暂停。已完成成果保留，未自动重新扣费。');put(p);
    }
  }
  const failedInCurrentRun=p=>p.tasks.filter(t=>t.runId===p.runId&&['failed','cancelled'].includes(t.status));
  const finish=id=>{
    const p=get(id);
    const failed=p.tasks.some(t=>t.runId===p.runId&&t.status==='failed');
    p.status=failed?'partial':'review';
    if(p.stage==='compose'&&p.outputUrl)p.status='completed';
    const unresolved=pending(p,p.stage).length;
    event(p,failed?'部分任务未完成。可以查看原因、重试失败项，或明确跳过。':unresolved?`本批次已完成，还有 ${unresolved} 项待生成。请确认下一批次。`:p.status==='completed'?'最终视频已合成。':`${stages.find(s=>s.id===p.stage).title}已完成，请审核后继续。`);
    put(p);active.delete(id);
  };
  async function execute(id,runId,tasks,signal) {
    try {
      // Sequential dispatch limits provider concurrency and makes stopping predictable.
      for(const task of tasks) {
        if(signal.aborted)break;
        let p=get(id);
        if(p.runId!==runId)break;
        const current=p.tasks.find(t=>t.id===task.id);
        current.status='running';current.startedAt=now();put(p);
        try {
          const sourceItem=task.target?entity(p,task.target):null;
          if(task.target?.referenceError)throw new Error(task.target.referenceError);
          if(task.stage==='videos'&&!task.target?.firstFrameUrl)throw new Error('请先生成或替换此镜头的分镜图，再生成视频。');
          const variant=task.stage==='design_images'&&task.target?.slot!=='imageUrl';
          if(variant&&!sourceItem?.imageUrl)throw new Error('请先生成或替换主图，再生成该变体。');
          const references=variant?(sourceItem.assetReferences?.[task.target.slot]||[sourceItem.imageUrl]):task.target?.references||[];
          const defaultImageSettings=task.stage==='design_images'?{ratio:task.target.entity==='scene'||task.target.slot==='turnaroundUrl'?'16:9':task.target.slot==='expressionUrl'?'3:4':'4:3',resolution:'2K'}:task.stage==='storyboard_images'?{resolution:'2K'}:{};
          const imageSettings=task.kind==='图片'?{...defaultImageSettings,...sourceItem?.assetSettings?.[task.target.slot]}:{};
          const out=task.kind==='compose'?await compose(p,signal):await generate({kind:task.kind,prompt:task.prompt,model:task.model,settings:{...p.settings,...imageSettings,duration:task.duration||p.settings.duration,firstFrameUrl:task.target?.firstFrameUrl||'',references,referenceLabels:task.target?.referenceLabels||[],workflow:false},signal});
          if(signal.aborted)break;
          p=get(id);
          if(p.runId!==runId)break;
          const row=p.tasks.find(t=>t.id===task.id);
          if(task.kind==='Agent'){
            const parsed=parseProductionOutput(task.stage,out.text||'');
            // Validate on a copy so a malformed result cannot invalidate confirmed work.
            const candidate=structuredClone(p);invalidate(candidate,task.stage);applyText(candidate,task.stage,parsed);p=candidate;
          }else{
            if(!out.outputUrl||!(/^(https:\/\/|\/(?:uploads|exports)\/)/.test(out.outputUrl)))throw new Error('服务没有返回可用的媒体地址。');
            if(task.kind==='compose')p.outputUrl=out.outputUrl;
            else {const item=entity(p,task.target);if(!item)throw new Error('任务目标已不存在');item[task.target.slot]=out.outputUrl;}
          }
          const done=p.tasks.find(t=>t.id===row.id);done.status='completed';done.finishedAt=now();done.outputUrl=out.outputUrl;put(p);
        }catch(error){
          if(signal.aborted)break;
          p=get(id);const row=p.tasks.find(t=>t.id===task.id);row.status='failed';row.error=error.message;row.finishedAt=now();put(p);
        }
      }
    } finally { if(!signal.aborted)finish(id); }
  }
  const launch=(p,stage,{mode='all',targetIds,targetNumbers,note,promptOverride}={})=>{
    if(active.has(p.id))fail('当前阶段正在执行');
    let specs;
    const meta=stages.find(s=>s.id===stage);
    if(meta.kind==='Agent'||stage==='compose'){
      if(targetIds?.length||targetNumbers?.length)fail('当前阶段不接受指定镜头');
      specs=meta.kind==='Agent'?[{title:meta.title,prompt:promptOverride||instruction(p,stage,note)}]:[{title:meta.title,prompt:'合成已确认的镜头与背景音乐'}];
    }
    else{
      const items=pending(p,stage);
      const selected=new Map();
      if(targetIds?.length){
        const matches=items.filter(x=>targetIds.includes(x.key||x.id));
        if(matches.length!==new Set(targetIds).size)fail('所选任务已完成或不属于当前阶段');
        matches.forEach(item=>selected.set(item.key||item.id,item));
      }
      if(targetNumbers?.length){
      if(!['storyboard_images','videos','shot_audio'].includes(stage))fail('只能按编号继续生成分镜图片、视频或音频');
        const requested=[...new Set(targetNumbers)];
        const matches=items.filter(x=>requested.includes(x.number));
        if(matches.length!==requested.length){
          const found=new Set(matches.map(x=>x.number));
          fail(`当前待生成镜头中未找到编号：${requested.filter(number=>!found.has(number)).join('、')}`);
        }
        matches.forEach(item=>selected.set(item.key||item.id,item));
      }
      if((targetIds?.length||targetNumbers?.length)&&!selected.size)fail('没有匹配的待生成项目');
      const chosen=selected.size?[...selected.values()]:items;
      specs=(mode==='one'?chosen.slice(0,1):chosen).map(target=>({title:target.title,prompt:target.prompt,target,duration:target.duration}));
    }
    if(!specs.length)fail('当前没有待执行任务');
    p.stage=stage;p.status='running';p.runId=randomUUID();
    const model=p.settings.models?.[meta.kind]||'';
    const tasks=specs.map(x=>({...x,id:randomUUID(),runId:p.runId,stage,agent:meta.agent,kind:meta.kind,model,status:'queued',createdAt:now()}));
    p.tasks.push(...tasks);event(p,`开始${meta.title}，共 ${tasks.length} 个任务。`);
    const snapshot=structuredClone(put(p));const controller=new AbortController();active.set(p.id,controller);
    void execute(p.id,p.runId,tasks,controller.signal);
    return snapshot;
  };
  function command(id,input) {
    const project=store.get('project',id);
    if(!project)fail('项目不存在',404);
    if(!isProductionProject(project))fail('自由画布项目使用普通画布工作流');
    const p=get(id);
    if(input.version!==p.version)fail('制作状态已更新，请刷新后再操作。');
    const action=input.action;
    if(!['edit','replace_asset','configure'].includes(action)&&[...assetRuns.keys()].some(key=>key.startsWith(`${id}:`)))fail('请等待角色图片任务完成，再推进制作阶段。');
    if(action==='stop'){
      if(p.status!=='running')fail('没有正在执行的制作任务');
      active.get(id)?.abort();active.delete(id);
      p.tasks.filter(t=>t.runId===p.runId&&['running','queued'].includes(t.status)).forEach(t=>{t.status='cancelled';t.finishedAt=now();});
      p.status='partial';event(p,'已停止后续任务。已经提交的请求可能仍产生服务用量。','user');return put(p);
    }
    if(p.status==='running'||active.has(id))fail('请等待当前任务完成，或先停止任务。');
    if(action==='start'){
      if(p.status!=='idle')fail('项目已有制作流程，请继续或修改现有阶段。');
      if(!input.prompt?.trim())fail('请填写创作需求',400);
      p.brief=input.prompt.trim();p.settings=input.settings||{};event(p,p.brief,'user');return launch(p,'script',{note:p.brief});
    }
    if(p.status==='idle')fail('请先提交创作需求');
    if(action==='recompose'){
      if(!p.shots.some(shot=>shot.videoUrl))fail('没有可合成的镜头视频');
      p.outputUrl='';event(p,'重新合成当前已确认的镜头与音乐。','user');
      return launch(p,'compose');
    }
    if(action==='configure'){
      const models=input.settings?.models||{};
      if(!Object.keys(models).length&&typeof input.settings?.separateShotAudio!=='boolean'&&!input.settings?.confirmation)fail('请选择制作模型或音频选项',400);
      p.settings={...p.settings,...input.settings,models:{...p.settings.models,...models}};
      event(p,input.settings?.confirmation?'已更新当前项目的二次确认设置。':Object.keys(models).length?`已更新制作模型：${Object.entries(models).map(([kind,model])=>`${kind} ${model}`).join('，')}`:p.settings.separateShotAudio?'已启用单独生成镜头音效与配音。':'镜头音频沿用视频原声，下一步生成背景音乐。','user');
      return put(p);
    }
    if(action==='revise'){
      if(!input.prompt?.trim())fail('请填写修改要求',400);
      if(failedInCurrentRun(p).length)fail('请先重试或跳过当前失败任务，再提交修改。');
      const phase={design_images:'design',storyboard_images:'storyboard',videos:'video_prompts',shot_audio:'video_prompts',music:'script',compose:'video_prompts'}[p.stage]||p.stage;
      event(p,input.prompt.trim(),'user');
      return launch(p,phase,{note:input.prompt});
    }
    if(action==='edit'){
      const item=[...p.characters,...p.scenes,...p.shots].find(x=>x.id===input.targetId);
      if(!item)fail('内容不存在',404);
      const isCharacter=p.characters.some(x=>x.id===item.id);
      const isScene=p.scenes.some(x=>x.id===item.id);
      const isShot=p.shots.some(x=>x.id===item.id);
      const allowed=isCharacter?['description','imagePrompt','turnaroundPrompt','expressionPrompt']:
        isScene?['description','imagePrompt','multiviewPrompt']:
        isShot?['description','imagePrompt','videoPrompt','audioPrompt','dialogue','duration']:[];
      const values=Object.fromEntries(Object.entries(input.changes||{}).filter(([key,value])=>allowed.includes(key)&&typeof value==='string'&&value.length<=12000));
      if(values.duration!==undefined){const duration=Number(values.duration);if(!Number.isFinite(duration)||duration<1||duration>30)fail('镜头时长需为 1–30 秒',400);values.duration=duration;}
      if(input.assetSettings||input.assetReferences){
        const slots=isCharacter?['imageUrl','turnaroundUrl','expressionUrl']:isScene?['imageUrl','multiviewUrl']:['imageUrl'];
        if(!slots.includes(input.assetSlot))fail('图片设置目标不正确',400);
        if(input.assetSettings){
          const settings=z.object({ratio:z.enum(['1:1','2:3','3:2','9:16','16:9','3:4','4:3','21:9','Auto']).optional(),resolution:z.enum(['1K','2K','4K']).optional(),quality:z.enum(['低','标准','高']).optional(),transparent:z.boolean().optional(),model:z.string().max(100).optional(),style:z.string().max(1000).optional()}).parse(input.assetSettings);
          item.assetSettings={...item.assetSettings,[input.assetSlot]:{...item.assetSettings?.[input.assetSlot],...settings}};
        }
        if(input.assetReferences)item.assetReferences={...item.assetReferences,[input.assetSlot]:input.assetReferences};
      }else if(!Object.keys(values).length)fail('没有可修改的字段',400);
      Object.assign(item,values);
      if(values.duration!==undefined){p.outputUrl='';if(p.status==='completed'){p.stage='compose';p.status='review';}}
      p.skipped=p.skipped.filter(key=>!key.endsWith(`:${item.id}`)&&!key.includes(`:${item.id}:`));
      const fieldLabels={description:'设定',imagePrompt:'主图提示词',turnaroundPrompt:'三视图提示词',expressionPrompt:'表情图提示词',multiviewPrompt:'多视角提示词',videoPrompt:'视频提示词',audioPrompt:'音效提示词',dialogue:'台词',duration:'时长'};
      event(p,`已修改「${item.name||item.title||'制作内容'}」的${Object.keys(values).map(key=>fieldLabels[key]).join('、')||'图片设置'}。`,'user');
      return put(p);
    }
    if(action==='replace_asset'){
      if(!input.assetUrl||!input.assetSlot)fail('请选择要替换的素材',400);
      const syntheticTarget=input.targetId==='production-music'||input.targetId==='production-output';
      if(syntheticTarget){
        if(input.targetId==='production-music'&&input.assetSlot==='audioUrl')p.musicUrl=input.assetUrl;
        else if(input.targetId==='production-output'&&input.assetSlot==='videoUrl')p.outputUrl=input.assetUrl;
        else fail('该产物不支持替换此类型的素材',400);
        event(p,`已替换「${input.targetId==='production-music'?'背景音乐':'最终成片'}」素材。`,'user');
        return put(p);
      }
      const item=[...p.characters,...p.scenes,...p.shots].find(x=>x.id===input.targetId);
      if(!item)fail('内容不存在',404);
      const allowed=p.characters.some(x=>x.id===item.id)
        ?['imageUrl','turnaroundUrl','expressionUrl']
        :p.scenes.some(x=>x.id===item.id)
          ?['imageUrl','multiviewUrl']
          :p.shots.some(x=>x.id===item.id)
            ?['imageUrl','videoUrl','audioUrl']
            :[];
      if(!allowed.includes(input.assetSlot))fail('该产物不支持替换此类型的素材',400);
      item[input.assetSlot]=input.assetUrl;
      const skipKey=p.characters.some(x=>x.id===item.id)||p.scenes.some(x=>x.id===item.id)?`design_images:${item.id}:${input.assetSlot}`:input.assetSlot==='imageUrl'?`storyboard_images:${item.id}`:input.assetSlot==='videoUrl'?`videos:${item.id}`:`shot_audio:${item.id}`;
      p.skipped=p.skipped.filter(key=>key!==skipKey);
      if(input.assetSlot==='videoUrl'||input.assetSlot==='audioUrl'){
        p.outputUrl='';if(p.status==='completed'){p.stage='compose';p.status='review';}
      }
      event(p,`已替换「${item.name||item.title||'制作内容'}」的${input.assetSlot}素材。`,'user');
      return put(p);
    }
    if(action==='skip'){
      if(stages.find(s=>s.id===p.stage).kind==='Agent'||p.stage==='compose')fail('此阶段不能跳过');
      const ids=input.targetIds||[];
      const candidates=pending(p,p.stage);
      if(!ids.length||ids.some(id=>!candidates.some(t=>(t.key||t.id)===id)))fail('请选择当前阶段待完成的项目');
      ids.forEach(id=>p.skipped.push(`${p.stage}:${id}`));
      p.tasks.filter(t=>t.stage===p.stage&&t.target&&ids.includes(t.target.key||t.target.id)&&['failed','cancelled'].includes(t.status)).forEach(t=>{t.status='skipped';t.finishedAt=now();});
      event(p,`已明确跳过 ${ids.length} 项。`,'user');p.status='review';return put(p);
    }
    if(action==='retry'){
      const failed=failedInCurrentRun(p);
      if(!failed.length)fail('没有可重试的失败任务');
      const ids=failed.flatMap(t=>t.target?[t.target.key||t.target.id]:[]);
      failed.forEach(task=>{task.status='retried';task.finishedAt=task.finishedAt||now();});
      event(p,`确认重试 ${failed.length} 个失败任务。`,'user');
      return launch(p,p.stage,{targetIds:ids.length?ids:undefined,promptOverride:failed[0]?.kind==='Agent'?failed[0].prompt:undefined});
    }
    if(action==='continue'){
      if(p.status!=='review'&&p.status!=='partial')fail('请先完成当前阶段');
      if(failedInCurrentRun(p).length)fail('当前阶段有失败任务，请先重试或明确跳过。');
      let stage=p.stage;
      if(!pending(p,stage).length){
        let next=stages[stages.findIndex(s=>s.id===stage)+1];
        if(next?.id==='shot_audio'&&!p.settings.separateShotAudio)next=stages.find(s=>s.id==='music');
        if(!next)fail('制作已结束');
        stage=next.id;
      }
      const prompt=input.prompt?.trim();
      const decision=prompt||(
        input.targetNumbers?.length?`确认继续镜头 ${input.targetNumbers.join('、')}`:
        input.mode==='one'?'确认，先生成一个':'满意，请继续'
      );
      event(p,decision,'user');
      return launch(p,stage,{mode:input.mode,targetIds:input.targetIds,targetNumbers:input.targetNumbers});
    }
    fail('不支持的制作操作',400);
  }
  // A single asset edit keeps the confirmed workflow stage and existing media intact.
  const generateAsset=(id,input)=>{
    const project=store.get('project',id);
    if(!project)fail('项目不存在',404);
    if(!isProductionProject(project))fail('自由画布项目使用普通画布工作流');
    let p=get(id);
    if(input.version!==p.version)fail('制作内容已更新，请刷新后重试。');
    if(p.status==='running'||active.has(id))fail('请等待当前阶段完成。');
    const item=p.characters.find(item=>item.id===input.targetId);
    const slot=input.assetSlot;
    const promptKey={imageUrl:'imagePrompt',turnaroundUrl:'turnaroundPrompt',expressionUrl:'expressionPrompt'}[slot];
    if(!item||!promptKey||item.imageSlots&&!item.imageSlots.includes(slot))fail('角色图片不存在',404);
    const key=`${id}:${item.id}:${slot}`;
    if(assetRuns.has(key))fail('这张图片正在生成，请等待完成。');
    const prompt=input.prompt?.trim()||item[promptKey];
    if(!prompt)fail('请填写图片提示词',400);
    const snapshot=JSON.stringify([item[slot],item[promptKey],item.assetSettings?.[slot],item.assetReferences?.[slot]]);
    const settings={ratio:slot==='turnaroundUrl'?'16:9':slot==='expressionUrl'?'3:4':'4:3',resolution:'2K',...item.assetSettings?.[slot],references:input.references||item.assetReferences?.[slot]||(slot==='imageUrl'?[]:[item.imageUrl].filter(Boolean)),workflow:false};
    const model=input.model||settings.model||p.settings.models?.['图片'];
    const task={id:randomUUID(),runId:randomUUID(),stage:'design_images',agent:'角色设计师',kind:'图片',title:`${item.name} · ${{imageUrl:'选角',turnaroundUrl:'三视图',expressionUrl:'表情图'}[slot]}`,model,prompt,status:'queued',createdAt:now(),assetEdit:true,target:{entity:'character',id:item.id,slot}};
    p.tasks.push(task);p=put(p);const controller=new AbortController();assetRuns.set(key,controller);
    void(async()=>{
      let generatedUrl='';
      try{
        let latest=get(id);Object.assign(latest.tasks.find(row=>row.id===task.id),{status:'running',startedAt:now()});put(latest);
        const out=await generate({kind:'图片',prompt,model,settings,signal:controller.signal});
        latest=get(id);const current=latest.characters.find(row=>row.id===item.id);const row=latest.tasks.find(row=>row.id===task.id);
        if(!out.outputUrl||!(/^(https:\/\/|\/(?:uploads|exports)\/)/.test(out.outputUrl)))throw new Error('服务没有返回可用图片');
        generatedUrl=out.outputUrl;row.outputUrl=generatedUrl;
        if(!current||snapshot!==JSON.stringify([current[slot],current[promptKey],current.assetSettings?.[slot],current.assetReferences?.[slot]]))throw new Error('生成期间该素材已修改，保留新修改。生成图片可从任务详情下载。');
        current[slot]=out.outputUrl;Object.assign(row,{status:'completed',finishedAt:now()});event(latest,`「${task.title}」已生成。`);put(latest);
      }catch(error){const latest=get(id);Object.assign(latest.tasks.find(row=>row.id===task.id),{status:'failed',error:error.message,...(generatedUrl?{outputUrl:generatedUrl}:{}),finishedAt:now()});put(latest);}
      finally{assetRuns.delete(key);}
    })();
    return {production:p,taskId:task.id};
  };
  return {get,command,generateAsset,stages,active};
}
