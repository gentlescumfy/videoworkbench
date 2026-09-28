import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, newProject } from '../server/store.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(readFileSync(path.join(root, 'reference/project.json'), 'utf8'));
const assets = JSON.parse(readFileSync(path.join(root, 'reference/assets.json'), 'utf8'));
const store = createStore(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'studio.sqlite'));
const projectId = 'a6b13e5a-7988-401a-b7c9-8ae54e82ee44';
if (store.get('project', projectId) && !process.argv.includes('--force')) {
  console.log(`Reference project already exists: ${projectId}`);
  process.exit(0);
}

const now = new Date().toISOString();
const hashOf = raw => {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const uri = url.searchParams.get('uri');
    return (uri || url.pathname).split('/').at(-1)?.replace(/\.[^.]+$/, '') || '';
  } catch { return ''; }
};
const assetByHash = new Map(assets.filter(a => a.localUrl).map(a => [hashOf(a.uri), a]));
const local = raw => assetByHash.get(hashOf(raw))?.localUrl || '';
const assetFor = (label, kind) => assets.find(a => a.label === label && a.kind === kind)?.localUrl || '';
const idFor = (type, number) => `reference-${type}-${String(number).padStart(2, '0')}`;
const section = source.script.split('## 三、人物设定')[1]?.split('## 四、分集剧本')[0] || '';
const characterDescription = name => {
  const chunks = section.split(/\*\*([^*]+)\*\*/);
  const index = chunks.findIndex((text, i) => i % 2 === 1 && text.includes(name));
  return index < 0 ? name : (chunks[index + 1] || '').trim();
};

const characters = source.roles.map(role => ({
  id: idFor('role', role.index),
  name: role.name,
  description: role.description || characterDescription(role.name),
  imagePrompt: role.imagePrompt || characterDescription(role.name) || role.name,
  imageSlots: ['imageUrl', ...(role.images[1] ? ['turnaroundUrl'] : []), ...(role.images[2] ? ['expressionUrl'] : [])],
  ...(role.assetSettings ? { assetSettings: role.assetSettings } : {}),
  ...(role.assetReferences ? { assetReferences: role.assetReferences } : {}),
  ...(role.turnaroundPrompt ? { turnaroundPrompt: role.turnaroundPrompt } : {}),
  ...(role.expressionPrompt ? { expressionPrompt: role.expressionPrompt } : {}),
  imageUrl: local(role.images[0]),
  ...(role.images[1] ? { turnaroundUrl: local(role.images[1]) } : {}),
  ...(role.images[2] ? { expressionUrl: local(role.images[2]) } : {}),
}));
const scenes = source.scenes.map(scene => ({
  id: idFor('scene', scene.index),
  name: scene.name,
  description: scene.description || scene.name,
  imagePrompt: scene.imagePrompt || scene.name,
  ...(scene.assetSettings ? { assetSettings: scene.assetSettings } : {}),
  ...(scene.multiviewPrompt ? { multiviewPrompt: scene.multiviewPrompt } : {}),
  imageUrl: local(scene.images[0]),
  multiviewUrl: local(scene.images[1]),
}));
const sceneFor = description => [...scenes].sort((a, b) => b.name.length - a.name.length).find(scene => description.includes(scene.name))?.id || scenes[0].id;
const promptPart = (prompt, start, end) => {
  const begin = prompt.indexOf(start);
  if (begin < 0) return '';
  const tail = prompt.slice(begin + start.length);
  const stop = end ? tail.indexOf(end) : -1;
  return (stop < 0 ? tail : tail.slice(0, stop)).trim().replace(/,$/, '').trim();
};
const shots = source.shots.map(shot => ({
  id: idFor('shot', shot.number),
  number: shot.number,
  title: `镜头 ${shot.number}`,
  description: shot.description,
  imagePrompt: shot.imagePrompt || shot.description,
  videoPrompt: shot.videoPrompt,
  audioPrompt: promptPart(shot.videoPrompt, 'storyboardAudioDescription:', '角色形象'),
  dialogue: promptPart(shot.videoPrompt, 'storyboardDialogue:', 'storyboardAudioDescription:'),
  characterIds: characters.filter(character => shot.description.includes(character.name)).map(character => character.id),
  sceneId: sceneFor(shot.description),
  duration: 15,
  imageUrl: assetFor(`分镜${shot.number}`, 'image'),
  ...(assetFor(`分镜${shot.number}`, 'video') ? { videoUrl: assetFor(`分镜${shot.number}`, 'video') } : {}),
}));
const tasks = [
  ...characters.map(item => ({ stage: 'design_images', kind: '图片', item })),
  ...scenes.map(item => ({ stage: 'design_images', kind: '图片', item })),
  ...shots.map(item => ({ stage: 'storyboard_images', kind: '图片', item })),
  ...shots.filter(item => item.videoUrl).map(item => ({ stage: 'videos', kind: '视频', item })),
].map(({ stage, kind, item }, index) => ({
  id: idFor('task', index + 1), runId: 'reference-import', stage, agent: stage === 'design_images' ? '角色 / 场景设计师' : '分镜师',
  kind, model: kind === '视频' ? 'minimax-h3-max' : '原项目模型', title: item.number ? `分镜 ${item.number}` : item.name,
  status: 'completed', target: { id: item.id }, outputUrl: kind === '视频' ? item.videoUrl : item.imageUrl,
  createdAt: now, startedAt: now, finishedAt: now,
}));
const brief = '竖屏 9:16，国风厚涂动态漫，中文对白；单集 150 秒。角色形象和场景在全部分镜中保持一致。';
const events = source.conversation?.length
  ? source.conversation.map((message, index) => ({
      id: idFor('event', index + 1), role: message.role, text: message.text,
      stage: 'videos', agent: message.text.includes('分镜师') ? '分镜师' : 'Oii Agent', createdAt: now,
    }))
  : [{ id: 'reference-event-import', role: 'assistant', text: '已从原项目导入剧本、7 个角色、10 个场景、28 个分镜、59 张图片与 5 段视频。原项目停在分镜视频阶段，可按编号逐个继续。', stage: 'videos', agent: 'Oii Agent', createdAt: now }];
const production = {
  id: projectId, version: 1, stage: 'videos', status: 'review', brief,
  settings: { ratio: '9:16', resolution: '768p', duration: 15, style: '国风厚涂动态漫', models: { 视频: 'minimax-h3-max' } },
  script: source.script, title: '凡骨逆天', characters, scenes, shots, tasks, events,
  runId: 'reference-import', musicUrl: '', outputUrl: '', skipped: [], updatedAt: now,
};
const project = newProject({
  id: projectId, name: source.title, category: '剧情故事创作', script: source.script,
  cover: shots[0]?.imageUrl || '',
});
store.put('project', project);
store.put('production', production);
for (const asset of assets.filter(a => a.localUrl)) {
  const file = path.join(root, 'data', asset.localUrl.slice(1));
  store.put('asset', {
    id: idFor('asset', asset.index), name: asset.label, category: asset.kind === 'video' ? '视频' : '图片',
    url: asset.localUrl, mime: asset.kind === 'video' ? 'video/mp4' : 'image/jpeg', size: statSync(file).size,
    favorite: false, trashed: false, createdAt: now, description: `原项目资源 ${asset.index}`,
  });
}
console.log(`Imported ${source.title}: ${characters.length} roles, ${scenes.length} scenes, ${shots.length} shots, ${shots.filter(s => s.videoUrl).length} videos`);
