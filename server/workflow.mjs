const allowedKinds=new Set(['文本','剧本','角色','场景','分镜','图片','视频','音频']);
const allowedActionTypes=new Set(['create_node','create_nodes','replace_script','split_storyboard','focus']);

const normalizeNode=value=>({
  kind:allowedKinds.has(value?.kind)?value.kind:'文本',
  title:typeof value?.title==='string'?value.title.slice(0,160):'画布内容',
  text:typeof value?.text==='string'?value.text.slice(0,50000):'',
  ...(Number.isFinite(value?.duration)?{duration:Math.min(3600,Math.max(.1,value.duration))}:{}),
});

export function sanitizeWorkflow(value) {
  if(!value||typeof value!=='object')return null;
  const actions=Array.isArray(value.actions)?value.actions.slice(0,100).flatMap(action=>{
    if(!action||typeof action!=='object'||!allowedActionTypes.has(action.type))return [];
    if(action.type==='create_nodes'){
      const nodes=Array.isArray(action.nodes)?action.nodes.slice(0,50).map(normalizeNode):[];
      return nodes.length?[{type:action.type,nodes}]:[];
    }
    if(action.type==='replace_script'||action.type==='split_storyboard'){
      return typeof action.script==='string'&&action.script.trim()?[{type:action.type,script:action.script.slice(0,200000)}]:[];
    }
    if(action.type==='focus'){
      return allowedKinds.has(action.kind)?[{type:action.type,kind:action.kind}]:[];
    }
    return [{type:action.type,...normalizeNode(action)}];
  }):[];
  const quickReplies=Array.isArray(value.quickReplies)
    ?value.quickReplies.filter(reply=>typeof reply==='string'&&reply.trim()).slice(0,4).map(reply=>reply.trim().slice(0,160))
    :[];
  return actions.length||quickReplies.length?{actions,...(quickReplies.length?{quickReplies}:{})}:null;
}

export function extractWorkflow(text) {
  if(typeof text!=='string')return null;
  const marker=text.match(/<oiioii-workflow>\s*([\s\S]*?)\s*<\/oiioii-workflow>/i);
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates=[marker?.[1],fenced?.[1],text.trim().startsWith('{')?text.trim():null].filter(Boolean);
  let parsed=null;
  for(const candidate of candidates){
    try{
      const value=JSON.parse(candidate);
      if(value&&typeof value==='object'){parsed=value;break;}
    }catch{}
  }
  const workflow=sanitizeWorkflow(parsed);
  if(!workflow)return null;
  const reply=typeof parsed.reply==='string'?parsed.reply.trim():text.replace(marker?.[0]||'','').replace(fenced?.[0]||'','').trim();
  return {text:reply||'已根据你的指令更新画布。',workflow};
}

export function splitStoryboard(script) {
  return script.split(/\n\s*\n|(?=^镜头\s*\d)|(?=^场\s*\d)/m)
    .map(value=>value.trim())
    .filter(Boolean)
    .slice(0,100);
}
