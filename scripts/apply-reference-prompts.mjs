import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../server/store.mjs';

const root=path.resolve(import.meta.dirname,'..');
const capture=JSON.parse(await readFile(process.argv[2]||path.join(root,'artifacts/reference-node-prompts.json'),'utf8'));
const sourcePath=path.join(root,'reference/project.json');
const source=JSON.parse(await readFile(sourcePath,'utf8'));
const assets=JSON.parse(await readFile(path.join(root,'reference/assets.json'),'utf8'));
const assetKey=url=>{try{const parsed=new URL(url);return parsed.protocol==='hogi:'?url:parsed.searchParams.get('uri')||parsed.pathname;}catch{return url;}};
const localReference=url=>assets.find(asset=>assetKey(asset.uri)===assetKey(url))?.localUrl||url;
const store=createStore(path.join(process.env.DATA_DIR||path.join(root,'data'),'studio.sqlite'));
const production=store.get('production','a6b13e5a-7988-401a-b7c9-8ae54e82ee44');
if(production?.status==='running')throw new Error('请等待当前制作任务完成后再补录提示词。');
let count=0;
for(const [group,sourceGroup,fields] of [['characters','roles',['description','imagePrompt','turnaroundPrompt','expressionPrompt']],['scenes','scenes',['description','imagePrompt','multiviewPrompt']]]){
 for(const captured of capture[group]||[]){
  const original=source[sourceGroup].find(item=>item.name===captured.name);
  if(!original)throw new Error(`原项目中没有 ${captured.name}`);
  const values=Object.fromEntries(fields.filter(key=>typeof captured[key]==='string'&&captured[key].trim()&&captured[key].length<=12000).map(key=>[key,captured[key]]));
  if(captured.assetSettings)values.assetSettings=captured.assetSettings;
  if(captured.assetReferences)values.assetReferences=Object.fromEntries(Object.entries(captured.assetReferences).map(([slot,urls])=>[slot,urls.map(localReference)]));
  if(group==='characters')values.imageSlots=['imageUrl',...(original.images[1]?['turnaroundUrl']:[]),...(original.images[2]?['expressionUrl']:[])];
  if(!Object.keys(values).length)continue;
  Object.assign(original,values);
  const item=production?.[group].find(item=>item.name===captured.name);if(item)Object.assign(item,values);
  count++;
 }
}
const promptPart=(prompt,start,end)=>{const begin=prompt.indexOf(start);if(begin<0)return '';const tail=prompt.slice(begin+start.length);const stop=end?tail.indexOf(end):-1;return (stop<0?tail:tail.slice(0,stop)).trim().replace(/,$/,'').trim();};
for(const captured of capture.shots||[]){
 const original=source.shots.find(shot=>shot.number===captured.number);
 if(!original)throw new Error(`原项目中没有镜头 ${captured.number}`);
 const values=Object.fromEntries(['imagePrompt','videoPrompt'].filter(key=>typeof captured[key]==='string'&&captured[key].trim()&&captured[key].length<=12000).map(key=>[key,captured[key]]));
 Object.assign(original,values);
 const item=production?.shots.find(shot=>shot.number===captured.number);
 if(item){Object.assign(item,values);if(values.videoPrompt){item.audioPrompt=promptPart(values.videoPrompt,'storyboardAudioDescription:','角色形象');item.dialogue=promptPart(values.videoPrompt,'storyboardDialogue:','storyboardAudioDescription:');}}
 count++;
}
await writeFile(sourcePath,JSON.stringify(source,null,2));
if(production){production.version++;production.updatedAt=new Date().toISOString();store.put('production',production);}
console.log(`Applied verified prompts to ${count} reference nodes; existing media and production settings retained.`);
