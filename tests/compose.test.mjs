import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { createStore } from '../server/store.mjs';
import { newProduction } from '../server/production.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=(args,{acceptFailure=false}={})=>new Promise((resolve,reject)=>{
 const child=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});let output='';
 child.stderr.on('data',chunk=>{output+=chunk;});child.on('error',reject);
 child.on('exit',code=>code===0||acceptFailure?resolve(output):reject(new Error(output.slice(-1500))));
});
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});

test('final composition preserves shot sound, mixes music and renders portrait video', {timeout:30000}, async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oiioii-compose-'));const uploads=path.join(dir,'uploads');await mkdir(uploads);
 let server;
 try{
  await run(['-loglevel','error','-y','-f','lavfi','-i','color=c=red:s=320x180:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(uploads,'first.mp4')]);
  await run(['-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p',path.join(uploads,'second.mp4')]);
  await run(['-loglevel','error','-y','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','1','-c:a','libmp3lame',path.join(uploads,'voice.mp3')]);
  await run(['-loglevel','error','-y','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','2','-c:a','libmp3lame',path.join(uploads,'music.mp3')]);
  const id='compose-integration';const store=createStore(path.join(dir,'studio.sqlite'));store.put('project',{id,category:'剧情故事创作'});
  const production=newProduction(id);production.stage='music';production.status='review';production.settings={ratio:'9:16',resolution:'480p'};production.musicUrl='/uploads/music.mp3';
  production.shots=[{id:'one',number:1,title:'one',description:'',imagePrompt:'',videoUrl:'/uploads/first.mp4',duration:1},{id:'two',number:2,title:'two',description:'',imagePrompt:'',videoUrl:'/uploads/second.mp4',audioUrl:'/uploads/voice.mp3',duration:1}];store.put('production',production);
  const port=await freePort();let logs='';server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,DATA_DIR:dir,PORT:String(port),NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});server.stderr.on('data',chunk=>{logs+=chunk;});server.stdout.on('data',chunk=>{logs+=chunk;});
  let ready=false;for(let attempt=0;attempt<100;attempt++){try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok){ready=true;break;}}catch{}await pause(80);}assert.ok(ready,logs);
  const response=await fetch(`http://127.0.0.1:${port}/api/projects/${id}/production/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:0,action:'continue'})});assert.equal(response.status,202,await response.text());
  let final;for(let attempt=0;attempt<250;attempt++){const current=await fetch(`http://127.0.0.1:${port}/api/projects/${id}/production`);final=(await current.json()).production;if(final.status!=='running')break;await pause(80);}
  assert.equal(final.status,'completed',JSON.stringify(final.tasks.at(-1)));
  assert.ok((await stat(path.join(dir,final.outputUrl.slice(1)))).size>0);
  const probe=await run(['-i',path.join(dir,final.outputUrl.slice(1))],{acceptFailure:true});
  assert.match(probe,/Video: h264/);assert.match(probe,/Audio: aac/);assert.match(probe,/480x854/);
 }finally{server?.kill('SIGTERM');await rm(dir,{recursive:true,force:true});}
});
