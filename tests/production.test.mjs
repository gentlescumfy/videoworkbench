import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { createProductionService, isProductionProject } from '../server/production.mjs';
import { parseNumberList, parseShotNumbers } from '../shared/shot-numbers.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fixture({category='剧情故事创作',failOnce=false}={}) {
  const id='test-production';
  const store=createStore(':memory:');
  store.put('project',{id,category});
  const attempts=new Map();
  const generatedPrompts=[];
  const generatedCalls=[];
  const generate=async({kind,prompt,model,settings})=>{
    if(kind==='Agent'){
      if(prompt.includes('只完成当前阶段：剧本。'))return {text:JSON.stringify({title:'测试短片',script:'第一场：清晨，主角走进旧车站。'})};
      if(prompt.includes('只完成当前阶段：角色与场景设定。'))return {text:JSON.stringify({
        characters:[{name:'主角',description:'年轻的旅行者',imagePrompt:'FAIL-ONCE 主角定妆照'}],
        scenes:[{name:'旧车站',description:'清晨的空车站',imagePrompt:'旧车站全景'}],
      })};
      if(prompt.includes('只完成当前阶段：分镜与图提示词。')){
        const production=store.get('production',id);
        return {text:JSON.stringify({shots:Array.from({length:3},(_,index)=>({
          title:`镜头 ${index+1}`,description:`主角动作 ${index+1}`,imagePrompt:`分镜画面 ${index+1}`,
          characterIds:[production.characters[0].id],sceneId:production.scenes[0].id,duration:5,
        }))})};
      }
      if(prompt.includes('只完成当前阶段：视频、音效与台词。')){
        const production=store.get('production',id);
        return {text:JSON.stringify({shots:production.shots.map(shot=>({
          id:shot.id,videoPrompt:'镜头缓慢推进',audioPrompt:'车站环境声',dialogue:'',
        }))})};
      }
      throw new Error('unexpected Agent stage');
    }
    generatedPrompts.push(prompt);
    generatedCalls.push({kind,prompt,model,settings});
    if(kind==='图片'&&failOnce&&prompt==='FAIL-ONCE 主角定妆照'){
      const count=(attempts.get(prompt)||0)+1;
      attempts.set(prompt,count);
      if(count===1)throw new Error('模拟图片生成失败');
    }
    return {outputUrl:`/uploads/${kind}-${generatedPrompts.length}.bin`};
  };
  const service=createProductionService({store,generate,compose:async()=>({outputUrl:'/exports/final.mp4'})});
  return {id,service,store,generatedPrompts,generatedCalls};
}

async function settled(service,id) {
  for(let attempt=0;attempt<200;attempt++){
    const production=service.get(id);
    if(production.status!=='running')return production;
    await pause(2);
  }
  throw new Error('production task did not settle');
}

function command(service,id,input) {
  const current=service.get(id);
  return service.command(id,{...input,version:current.version});
}

async function start(service,id) {
  command(service,id,{action:'start',prompt:'制作一段清晨车站的短片',settings:{}});
  return settled(service,id);
}

async function continueTo(service,id,targetStage) {
  let production=service.get(id);
  while(production.stage!==targetStage){
    command(service,id,{action:'continue'});
    production=await settled(service,id);
  }
  return production;
}

test('production projects are separated from free canvas and confirmation gates each stage',async()=>{
  assert.equal(isProductionProject({category:'自由画布'}),false);
  assert.equal(isProductionProject({category:'剧情故事创作'}),true);
  const {service,id}=fixture();
  const free=fixture({category:'自由画布'});
  assert.throws(()=>free.service.command(free.id,{version:0,action:'start',prompt:'test'}),/自由画布/);

  command(service,id,{action:'start',prompt:'制作一段清晨车站的短片',settings:{}});
  const running=service.get(id);
  assert.equal(running.stage,'script');
  assert.equal(running.status,'running');
  assert.throws(()=>service.command(id,{version:running.version,action:'continue'}),/等待当前任务/);
  const review=await settled(service,id);
  assert.equal(review.status,'review');
  assert.equal(review.stage,'script');
  assert.match(review.events.find(event=>event.role==='user').text,/清晨车站/);
  const designRun=command(service,id,{action:'continue',prompt:'满意，请继续'});
  assert.equal(designRun.stage,'design');
  assert.equal((await settled(service,id)).stage,'design');
});

test('batch mode creates per-asset tasks and uses primary images for variants',async()=>{
  const {service,id,generatedCalls}=fixture();
  await start(service,id);
  await continueTo(service,id,'design');
  command(service,id,{action:'continue',mode:'one'});
  let production=await settled(service,id);
  assert.equal(production.stage,'design_images');
  assert.equal(production.tasks.filter(task=>task.runId===production.runId).length,1);
  assert.equal(Number(Boolean(production.characters[0].imageUrl))+Number(Boolean(production.scenes[0].imageUrl)),1);

  command(service,id,{action:'continue',mode:'all'});
  production=await settled(service,id);
  assert.ok(production.characters[0].imageUrl);
  assert.ok(production.characters[0].turnaroundUrl);
  assert.ok(production.characters[0].expressionUrl);
  assert.ok(production.scenes[0].imageUrl);
  assert.ok(production.scenes[0].multiviewUrl);
  assert.equal(production.characters.length,1);
  assert.equal(production.scenes.length,1);
  assert.ok(generatedCalls.some(call=>call.kind==='图片'&&call.prompt.includes('正面、侧面、背面三视图')&&call.settings.references[0]===production.characters[0].imageUrl));
});

test('imported role asset choices do not generate extra variants',async()=>{
 const {service,id,store,generatedCalls}=fixture();await start(service,id);await continueTo(service,id,'design');
 const p=service.get(id);p.characters[0].imageSlots=['imageUrl'];store.put('production',p);
 command(service,id,{action:'continue'});const result=await settled(service,id);
 assert.equal(generatedCalls.length,3);assert.equal(result.characters[0].turnaroundUrl,undefined);assert.equal(result.characters[0].expressionUrl,undefined);
});

test('asset image ratios and explicit expression reference survive portrait video settings',async()=>{
 const {service,id,store,generatedCalls}=fixture();await start(service,id);await continueTo(service,id,'design');
 const p=service.get(id);p.settings.ratio='9:16';p.settings.resolution='768p';
 p.characters[0].assetReferences={expressionUrl:['/uploads/head-crop.jpg']};
 p.characters[0].assetSettings={expressionUrl:{ratio:'3:4',resolution:'4K'}};store.put('production',p);
 command(service,id,{action:'continue'});await settled(service,id);
 const images=generatedCalls.filter(call=>call.kind==='图片');
 assert.deepEqual(images.map(call=>call.settings.ratio),['4:3','16:9','3:4','16:9','16:9']);
 assert.equal(images[0].settings.resolution,'2K');assert.equal(images[2].settings.resolution,'4K');
 assert.deepEqual(images[2].settings.references,['/uploads/head-crop.jpg']);
});

test('original workflow advances from videos to music using embedded sound by default',async()=>{
 const {service,id,generatedCalls}=fixture();await start(service,id);await continueTo(service,id,'videos');
 command(service,id,{action:'continue'});const result=await settled(service,id);
 assert.equal(result.stage,'music');assert.ok(result.shots.every(shot=>!shot.audioUrl));assert.equal(generatedCalls.filter(call=>call.kind==='音频').length,1);
});

test('numbered continuation runs only the requested pending storyboard shots',async()=>{
  const {service,id}=fixture();
  await start(service,id);
  const production=await continueTo(service,id,'storyboard');
  assert.equal(production.shots.length,3);
  assert.deepEqual(production.shots.map(shot=>shot.number),[1,2,3]);
  assert.throws(()=>command(service,id,{action:'continue',targetNumbers:[4]}),/未找到编号/);

  command(service,id,{action:'continue',mode:'all',targetNumbers:[1,3],prompt:'继续生成分镜 1、3'});
  const completed=await settled(service,id);
  assert.ok(completed.shots[0].imageUrl);
  assert.equal(completed.shots[1].imageUrl,undefined);
  assert.ok(completed.shots[2].imageUrl);
  assert.deepEqual(completed.tasks.filter(task=>task.runId===completed.runId).map(task=>task.target.number),[1,3]);
  assert.equal(completed.events.filter(event=>event.role==='user').at(-1).text,'继续生成分镜 1、3');
});

test('failed subtasks block progression until an explicit retry succeeds',async()=>{
  const {service,id}=fixture({failOnce:true});
  await start(service,id);
  let production=await continueTo(service,id,'design_images');
  assert.equal(production.status,'partial');
  assert.equal(production.tasks.filter(task=>task.runId===production.runId&&task.status==='failed').length,3);
  assert.throws(()=>command(service,id,{action:'continue'}),/重试或明确跳过/);

  command(service,id,{action:'retry'});
  production=await settled(service,id);
  assert.equal(production.status,'review');
  assert.equal(production.tasks.filter(task=>task.runId===production.runId&&task.status==='completed').length,3);
  assert.equal(production.tasks.filter(task=>task.status==='retried').length,3);
  assert.ok(production.characters[0].imageUrl);
  assert.ok(production.scenes[0].imageUrl);
});

test('skipping a failed target records the decision and releases the stage gate',async()=>{
  const {service,id}=fixture({failOnce:true});
  await start(service,id);
  let production=await continueTo(service,id,'design_images');
  const failed=production.tasks.find(task=>task.runId===production.runId&&task.status==='failed');
  const failedKeys=production.tasks.filter(task=>task.runId===production.runId&&task.status==='failed').map(task=>task.target.key);
  command(service,id,{action:'skip',targetIds:failedKeys});
  production=service.get(id);
  assert.equal(production.status,'review');
  assert.ok(production.skipped.includes(`design_images:${failed.target.key}`));
  assert.equal(production.tasks.find(task=>task.id===failed.id).status,'skipped');
  command(service,id,{action:'continue'});
  production=await settled(service,id);
  assert.equal(production.stage,'storyboard');
});

test('manual prompt edits are used by the next image task',async()=>{
  const {service,id,generatedPrompts}=fixture();
  await start(service,id);
  await continueTo(service,id,'design');
  const production=service.get(id);
  const character=production.characters[0];
  command(service,id,{action:'edit',targetId:character.id,changes:{imagePrompt:'用户修改后的角色正面设定图'}});
  const edited=service.get(id);
  assert.equal(edited.characters[0].imagePrompt,'用户修改后的角色正面设定图');
  command(service,id,{action:'continue',mode:'all'});
  await settled(service,id);
  assert.ok(generatedPrompts.includes('用户修改后的角色正面设定图'));
});

test('editing a completed node keeps its media available for review',async()=>{
  const {service,id}=fixture();
  await start(service,id);
  await continueTo(service,id,'videos');
  const before=service.get(id);
  const character=before.characters[0];
  const shot=before.shots[0];
  assert.ok(character.imageUrl);
  assert.ok(shot.videoUrl);
  command(service,id,{action:'edit',targetId:character.id,changes:{imagePrompt:'调整后的角色提示词'}});
  command(service,id,{action:'edit',targetId:shot.id,changes:{videoPrompt:'调整后的镜头提示词'}});
  const after=service.get(id);
  assert.equal(after.characters[0].imagePrompt,'调整后的角色提示词');
  assert.equal(after.characters[0].imageUrl,character.imageUrl);
  assert.equal(after.shots[0].videoPrompt,'调整后的镜头提示词');
  assert.equal(after.shots[0].videoUrl,shot.videoUrl);
  assert.throws(()=>command(service,id,{action:'edit',targetId:shot.id,changes:{duration:'35'}}),/1–30 秒/);
  command(service,id,{action:'edit',targetId:shot.id,changes:{duration:'12'}});
  assert.equal(service.get(id).shots[0].duration,12);
});

test('the guided production pipeline finishes storyboard video, shot audio, music, and composition stages',async()=>{
  const {service,id}=fixture();
  await start(service,id);
  await continueTo(service,id,'storyboard_images');
  command(service,id,{action:'continue',mode:'all'});
  await settled(service,id);
  await continueTo(service,id,'video_prompts');
  command(service,id,{action:'continue'});
  await settled(service,id);
  await continueTo(service,id,'videos');
  let production=service.get(id);
  assert.ok(production.shots.every(shot=>shot.videoUrl));
  assert.equal(production.status,'review');
  command(service,id,{action:'configure',settings:{separateShotAudio:true}});
  command(service,id,{action:'continue'});
  production=await settled(service,id);
  assert.equal(production.stage,'shot_audio');
  assert.ok(production.shots.every(shot=>shot.audioUrl));
  command(service,id,{action:'continue'});
  production=await settled(service,id);
  assert.equal(production.stage,'music');
  assert.ok(production.musicUrl);
  command(service,id,{action:'continue'});
  production=await settled(service,id);
  assert.equal(production.stage,'compose');
  assert.equal(production.status,'completed');
  assert.equal(production.outputUrl,'/exports/final.mp4');
  command(service,id,{action:'replace_asset',targetId:production.shots[0].id,assetSlot:'videoUrl',assetUrl:'/uploads/replacement.mp4'});
  production=service.get(id);
  assert.equal(production.stage,'compose');
  assert.equal(production.status,'review');
  assert.equal(production.outputUrl,'');
  command(service,id,{action:'recompose'});
  production=await settled(service,id);
  assert.equal(production.status,'completed');
  assert.equal(production.outputUrl,'/exports/final.mp4');
});

test('video tasks receive the confirmed storyboard frame and matching character and scene references',async()=>{
  const {service,id,generatedCalls}=fixture();
  await start(service,id);
  await continueTo(service,id,'video_prompts');
  command(service,id,{action:'continue'});
  await settled(service,id);
  const production=service.get(id);
  const shot=production.shots[0];
  const videoCall=generatedCalls.find(call=>call.kind==='视频');
  assert.ok(videoCall);
  assert.equal(videoCall.settings.firstFrameUrl,shot.imageUrl);
  assert.deepEqual(videoCall.settings.references,[production.characters[0].imageUrl,production.scenes[0].imageUrl]);
  assert.equal(videoCall.settings.duration,shot.duration);
  assert.match(shot.videoUrl,/^\/uploads\/视频-\d+\.bin$/);
});

test('the current stage model can be changed without losing imported media',async()=>{
  const {service,id}=fixture();
  await start(service,id);
  await continueTo(service,id,'videos');
  const before=service.get(id);
  const firstVideo=before.shots[0].videoUrl;
  command(service,id,{action:'configure',settings:{models:{'视频':'configured-video-model'}}});
  const after=service.get(id);
  assert.equal(after.settings.models['视频'],'configured-video-model');
  assert.equal(after.shots[0].videoUrl,firstVideo);
});

test('shot number parsing supports lists, ranges, and Chinese ordinal phrasing',()=>{
  assert.deepEqual(parseNumberList('1, 3, 5-8'),[1,3,5,6,7,8]);
  assert.deepEqual(parseShotNumbers('继续生成分镜 1, 3, 5-8'),[1,3,5,6,7,8]);
  assert.deepEqual(parseShotNumbers('先做第5个分镜'),[5]);
  assert.deepEqual(parseShotNumbers('重试镜头 2、4到5'),[2,4,5]);
  assert.deepEqual(parseNumberList('0, 1'),[]);
  assert.deepEqual(parseNumberList('8-5'),[]);
});

function assetFixture(generate){
 const id='asset-edit-project',store=createStore(':memory:');store.put('project',{id,category:'剧情故事创作'});
 const service=createProductionService({store,generate,compose:async()=>({})});
 const p=service.get(id);Object.assign(p,{stage:'videos',status:'partial',runId:'confirmed-video-run',characters:[{id:'role',name:'角色',description:'设定',imagePrompt:'选角提示词',turnaroundPrompt:'三视图提示词',expressionPrompt:'表情提示词',imageUrl:'/uploads/main.png',turnaroundUrl:'/uploads/turn.png',expressionUrl:'/uploads/expression.png',imageSlots:['imageUrl','turnaroundUrl','expressionUrl'],assetSettings:{expressionUrl:{ratio:'3:4',resolution:'2K'}},assetReferences:{expressionUrl:['/uploads/head.png']}}],shots:[{id:'shot',videoUrl:'/uploads/confirmed-video.mp4'}]});store.put('production',p);
 return {id,store,service};
}
async function settledAsset(service,id,taskId){
 for(let attempt=0;attempt<200;attempt++){const p=service.get(id);if(!['queued','running'].includes(p.tasks.find(task=>task.id===taskId)?.status))return p;await pause(2);}
 throw new Error('asset task did not settle');
}
const generateRole=(service,id,input={})=>service.generateAsset(id,{version:service.get(id).version,targetId:'role',assetSlot:'expressionUrl',model:'configured-image-model',...input});

test('single role regeneration updates only its slot and preserves the confirmed workflow',async()=>{
 let received;const {id,service}=assetFixture(async input=>{received=input;return {outputUrl:'/uploads/new-expression.png'};});
 const before=service.get(id);const {taskId}=generateRole(service,id);const after=await settledAsset(service,id,taskId);
 assert.equal(after.stage,before.stage);assert.equal(after.status,before.status);assert.equal(after.runId,before.runId);
 assert.equal(after.characters[0].expressionUrl,'/uploads/new-expression.png');assert.equal(after.characters[0].imageUrl,before.characters[0].imageUrl);assert.equal(after.characters[0].turnaroundUrl,before.characters[0].turnaroundUrl);assert.deepEqual(after.shots,before.shots);
 assert.equal(received.model,'configured-image-model');assert.equal(received.prompt,'表情提示词');assert.deepEqual(received.settings.references,['/uploads/head.png']);assert.equal(received.settings.ratio,'3:4');assert.equal(received.settings.workflow,false);
});

test('role regeneration submits the edited prompt, chosen references, and supported image settings',async()=>{
 let received;const {id,service}=assetFixture(async input=>{received=input;return {outputUrl:'/uploads/regenerated.png'};});
 command(service,id,{action:'edit',targetId:'role',assetSlot:'expressionUrl',assetSettings:{ratio:'3:4',resolution:'4K',quality:'高',transparent:true,model:'configured-image-model'},assetReferences:['/uploads/new-reference.png']});
 const {taskId}=generateRole(service,id,{prompt:'按新提示词重绘',references:['/uploads/confirmed-reference.png']});
 const after=await settledAsset(service,id,taskId);
 assert.equal(after.tasks.find(task=>task.id===taskId).status,'completed');
 assert.equal(received.model,'configured-image-model');assert.equal(received.prompt,'按新提示词重绘');
 assert.deepEqual(received.settings.references,['/uploads/confirmed-reference.png']);
 assert.equal(received.settings.resolution,'4K');assert.equal(received.settings.quality,'高');assert.equal(received.settings.transparent,true);
});

test('asset tasks reject duplicate submissions and stage changes while allowing edits',async()=>{
 let complete;const {id,service}=assetFixture(()=>new Promise(resolve=>{complete=resolve;}));const {taskId}=generateRole(service,id);
 assert.throws(()=>generateRole(service,id),/正在生成/);assert.throws(()=>command(service,id,{action:'continue'}),/等待角色图片任务/);
 command(service,id,{action:'edit',targetId:'role',changes:{imagePrompt:'只修改另一张图片'}});
 complete({outputUrl:'/uploads/new-expression.png'});const p=await settledAsset(service,id,taskId);assert.equal(p.tasks.find(t=>t.id===taskId).status,'completed');assert.equal(p.characters[0].imagePrompt,'只修改另一张图片');
});

test('provider failure preserves old role media and records a failed asset task',async()=>{
 const {id,service}=assetFixture(async()=>{throw new Error('模拟提供方失败');});const {taskId}=generateRole(service,id);const p=await settledAsset(service,id,taskId);
 assert.equal(p.characters[0].expressionUrl,'/uploads/expression.png');assert.equal(p.stage,'videos');assert.equal(p.status,'partial');assert.equal(p.tasks.find(t=>t.id===taskId).status,'failed');assert.match(p.tasks.find(t=>t.id===taskId).error,/模拟提供方失败/);
});

test('editing a generating asset retains the newer edit and the generated result for review',async()=>{
 let complete;const {id,service}=assetFixture(()=>new Promise(resolve=>{complete=resolve;}));const {taskId}=generateRole(service,id);
 command(service,id,{action:'edit',targetId:'role',changes:{expressionPrompt:'较新的用户修改'}});complete({outputUrl:'/uploads/review-result.png'});const p=await settledAsset(service,id,taskId),task=p.tasks.find(t=>t.id===taskId);
 assert.equal(p.characters[0].expressionPrompt,'较新的用户修改');assert.equal(p.characters[0].expressionUrl,'/uploads/expression.png');assert.equal(task.outputUrl,'/uploads/review-result.png');assert.equal(task.status,'failed');assert.match(task.error,/素材已修改/);
});

test('per-asset settings and references save independently and invalid settings fail',()=>{
 const {id,service}=assetFixture(async()=>({}));command(service,id,{action:'edit',targetId:'role',assetSlot:'imageUrl',assetSettings:{resolution:'4K',quality:'高',transparent:true,model:'chosen-model'},assetReferences:['/uploads/new-ref.png']});
 const role=service.get(id).characters[0];assert.equal(role.assetSettings.imageUrl.resolution,'4K');assert.equal(role.assetSettings.imageUrl.model,'chosen-model');assert.deepEqual(role.assetReferences.imageUrl,['/uploads/new-ref.png']);assert.equal(role.assetSettings.expressionUrl.resolution,'2K');assert.deepEqual(role.assetReferences.expressionUrl,['/uploads/head.png']);
 assert.throws(()=>command(service,id,{action:'edit',targetId:'role',assetSlot:'videoUrl',assetSettings:{resolution:'2K'}}),/设置目标不正确/);
 assert.throws(()=>command(service,id,{action:'edit',targetId:'role',assetSlot:'imageUrl',assetSettings:{resolution:'8K'}}));
});

test('restart marks unfinished asset edits failed without changing the workflow or resubmitting',()=>{
 const {id,service,store}=assetFixture(async()=>({}));const p=service.get(id);p.tasks.push({id:'unfinished',assetEdit:true,status:'running'});store.put('production',p);
 let submitted=0;const restarted=createProductionService({store,generate:async()=>{submitted++;},compose:async()=>({})}),after=restarted.get(id);
 assert.equal(after.stage,'videos');assert.equal(after.status,'partial');assert.equal(after.tasks.at(-1).status,'failed');assert.equal(submitted,0);assert.equal(after.characters[0].expressionUrl,'/uploads/expression.png');
});
