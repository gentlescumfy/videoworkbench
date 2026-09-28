import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoRequest } from '../server/video-request.mjs';
import { videoReferencePlan } from '../server/production.mjs';

test('video references follow prompt numbers rather than character storage order',()=>{
 const p={characters:[{id:'young',name:'沈砚',imageUrl:'https://cdn.example/young.png'},{id:'old',name:'玄尘',imageUrl:'https://cdn.example/old.png'}],scenes:[{id:'cliff',name:'寒潭崖',imageUrl:'https://cdn.example/cliff.png'}]};
 const shot={imageUrl:'https://cdn.example/board.png',characterIds:['young','old'],sceneId:'cliff',videoPrompt:'使用@图1（多宫格关键帧），@图2（玄尘）指向@图3（沈砚）。'};
 const plan=videoReferencePlan(p,shot);
 assert.equal(plan.referenceError,'');
 assert.deepEqual(plan.references,['https://cdn.example/old.png','https://cdn.example/young.png']);
 const request=buildVideoRequest('agnes-video-2.5-flash',shot.videoPrompt,{...plan,duration:12,ratio:'9:16',resolution:'768p'});
 assert.equal(request.mode,'reference');assert.equal(request.seconds,'12');assert.equal(request.size,'720P');
 assert.deepEqual(request.images,[shot.imageUrl,...plan.references]);
 assert.match(request.prompt,/<Picture 2>（玄尘）/);assert.match(request.prompt,/<Picture 3>（沈砚）/);
 assert.equal(request.first_frame,undefined);
 p.characters[1].imageUrl='';assert.match(videoReferencePlan(p,shot).referenceError,/没有对应参考图/);
});

test('a reference omitted from visual prose retains its voice-style position',()=>{
 const p={characters:[{id:'messenger',name:'使者',imageUrl:'https://cdn.example/messenger.png'},{id:'elder',name:'大长老',imageUrl:'https://cdn.example/elder.png'},{id:'hero',name:'沈砚',imageUrl:'https://cdn.example/hero.png'}],scenes:[]};
 const shot={imageUrl:'https://cdn.example/board.png',videoPrompt:'@图2（使者）俯视@图4（沈砚）。voicestyle:{"character":"使者"}{"character":"大长老"}{"character":"沈砚"}'};
 const plan=videoReferencePlan(p,shot);assert.equal(plan.referenceError,'');assert.deepEqual(plan.referenceLabels,['分镜关键帧','使者','大长老','沈砚']);
});

test('Agnes keyframes use URLs and remain separate from reference mode',()=>{
 const request=buildVideoRequest('agnes-video-2.5','镜头推进',{duration:5,firstFrameUrl:'https://cdn.example/first.png',lastFrameUrl:'https://cdn.example/last.png',resolution:'1080p'});
 assert.equal(request.mode,'keyframe');assert.equal(request.first_frame,'https://cdn.example/first.png');assert.equal(request.last_frame,'https://cdn.example/last.png');assert.equal(request.images,undefined);
 assert.equal(buildVideoRequest('agnes-video-2.5-flash','纯文本',{duration:5}).mode,'text');
});

test('unsupported durations and inaccessible references fail before dispatch',()=>{
 assert.throws(()=>buildVideoRequest('agnes-video-2.5-flash','test',{duration:15}),/4–12 秒/);
 assert.throws(()=>buildVideoRequest('agnes-video-2.5-flash','test',{duration:5,firstFrameUrl:'data:image/png;base64,AA=='}),/HTTPS/);
 assert.throws(()=>buildVideoRequest('agnes-video-2.5-flash','test',{duration:5,firstFrameUrl:'https://cdn.example/first.png',lastFrameUrl:'https://cdn.example/last.png',references:['https://cdn.example/role.png']}),/不能同时使用/);
 assert.throws(()=>buildVideoRequest('agnes-video-2.5-flash','test',{duration:5,references:Array(6).fill('https://cdn.example/role.png')}),/最多支持 5 张/);
});

test('legacy video adapter retains a 15 second portrait frame request',()=>{
 const request=buildVideoRequest('agnes-video-v2.0','test',{duration:15,ratio:'9:16',resolution:'768p',firstFrameUrl:'data:image/png;base64,AA=='});
 assert.equal(request.image,'data:image/png;base64,AA==');assert.equal(request.num_frames,361);assert.equal(request.frame_rate,24);assert.equal(request.width,768);assert.equal(request.height,1366);
});
