import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dir=path.resolve('public/assets'); await mkdir(dir,{recursive:true});
const bundle='/var/folders/96/vw56c4tn3m5c6kd5mk0l02v00000gn/T/browser-use/assets/65a9549a-f781-4a55-b819-2403a7e16ebb';
const files={
  'work-0.webp':'7d3c333485e4ec0b.webp','work-1.webp':'bd6163e922accdae.webp','work-2.webp':'0a834f8d359784fe.webp','work-3.webp':'e4dae172af9eebfb.webp','work-4.webp':'71e855b35b7b8136.webp',
  'canvas.webp':'70820e3bba7a984d.webp','remix.webp':'fa4abbb4ecc18ee7.webp','board.webp':'6133a4c84f2012c0.webp','character.webp':'7e77194cbb4e090b.webp','scene.webp':'b8f053ab45fa8581.webp','gif.webp':'dcf318c7f8191b35.webp','stage.webp':'a9239d5e11c676a1.webp',
  'writer.png':'c381dc30b03d6b73.png','director.png':'ec0c37d804683d9b.png','avatar.jpg':'f3f0a783799b76eb.jpg','campaign.png':'00f7fef705e344c2.png',
};
for(const [to,from] of Object.entries(files)) await copyFile(path.join(bundle,from),path.join(dir,to));
await copyFile(path.join(dir,'board.webp'),path.join(dir,'story.webp'));
const refs=[
  ['image','mucg3ow2_25269e4a20d487f2.png'],['video','muf3klns_2414e7f58e77f37d.mp4'],['video','muf3zhm2_02ebd8efc745a28b.mp4'],['video','muf4kib9_ba710b1fb1032b72.mp4'],
  ['video','media_uploads/fc245153-be01-488d-9205-485994d68485.mp4'],['video','media_uploads/292dd1a4-86ca-47aa-af8b-53aecc734a6a.mp4'],['video','mu0uzi0q_e65bd32d34d0b582.mp4'],
  ['image','mu5k4xmu_4e3495c2a9036255.png'],['image','mtmyyw73_b35a379e0adf1fd8.png'],['video','media_uploads/bda90578-321f-474b-879a-0cc4ed740df1.mp4'],
  ['video','media_uploads/45daeb74-ef0d-4445-ad34-7240713e5473.mp4'],['video','mu523ot1_f83bdef19e429777.mp4'],['video','media_uploads/fbac964a-6b25-4214-97f6-12600d1c6136.mp4'],
  ['video','media_uploads/17821026-d9fc-4082-918a-8b1705d68241.mp4'],['video','mu3xkksf_94b598aa625e31ec.mp4'],['image','mu0yrc2g_9c4228eff067d704.png'],['image','mtmvjaos_67b1263990b12326.png']
];
const manifest=[];
for(let i=0;i<refs.length;i++) {
 const [kind,file]=refs[i]; const url=`https://api.oiioii.ai/res/${kind==='video'?'first_frame':'read_file'}?uri=${encodeURIComponent(`hogi://${kind}/${file}`)}${kind==='video'?'&timeMs=2000':''}`;
 try { const res=await fetch(url,{signal:AbortSignal.timeout(20000)}); if(!res.ok||!res.headers.get('content-type')?.startsWith('image/'))throw new Error(`HTTP ${res.status}`); await writeFile(path.join(dir,`skill-${i}.jpg`),Buffer.from(await res.arrayBuffer())); manifest.push({file:`skill-${i}.jpg`,source:url}); console.log(`skill-${i}: OK`); }
 catch(e) { console.log(`skill-${i}: ${e.message}`); await copyFile(path.join(dir,`work-${i%5}.webp`),path.join(dir,`skill-${i}.jpg`)); manifest.push({file:`skill-${i}.jpg`,source:url,fallback:true}); }
}
await writeFile(path.join(dir,'sources.json'),JSON.stringify({note:'Public visual references captured 2026-09-27. No account credentials or private project content exported. Original rights remain with their owners.',references:manifest},null,2));
