export function buildChatMessages({prompt,systemPrompt='',references=[],history=[]}) {
  const messages=systemPrompt?[{role:'system',content:systemPrompt}]:[];
  if(Array.isArray(history))for(const message of history.slice(-12)) {
    if(!message||!['user','assistant'].includes(message.role)||typeof message.text!=='string'||!message.text.trim())continue;
    messages.push({role:message.role,content:message.text.slice(0,12000)});
  }
  if(!Array.isArray(references))throw new Error('Agent 参考图格式不正确');
  const images=[...new Set(references)].filter(Boolean);
  if(images.length>10)throw new Error('最多引用 10 张图片');
  for(const url of images)if(typeof url!=='string'||!/^https:\/\//.test(url)&&!/^data:image\/[\w.+-]+;base64,/.test(url))throw new Error('Agent 参考图地址不正确');
  const content=images.length?[{type:'text',text:prompt},...images.map(url=>({type:'image_url',image_url:{url}}))]:prompt;
  messages.push({role:'user',content});
  return messages;
}
