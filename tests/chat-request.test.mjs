import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatMessages } from '../server/chat-request.mjs';

test('角色 Agent 请求保留对话轮次并发送有序参考图',()=>{
  const refs=['data:image/png;base64,YQ==','https://example.com/role.jpg'];
  const messages=buildChatMessages({prompt:'把衣服换成蓝色',references:[...refs,refs[0]],history:[{role:'user',text:'保留原来的脸'},{role:'assistant',text:'好的'}]});
  assert.deepEqual(messages.slice(0,2),[{role:'user',content:'保留原来的脸'},{role:'assistant',content:'好的'}]);
  assert.deepEqual(messages[2].content,[{type:'text',text:'把衣服换成蓝色'},...refs.map(url=>({type:'image_url',image_url:{url}}))]);
});

test('纯文本工作流保持系统指令并过滤不支持的历史角色',()=>{
  const messages=buildChatMessages({prompt:'编写剧本',systemPrompt:'输出阶段 JSON',history:[{role:'system',text:'无效历史'},{role:'assistant',text:''}]});
  assert.deepEqual(messages,[{role:'system',content:'输出阶段 JSON'},{role:'user',content:'编写剧本'}]);
});

test('错误参考图在提交给提供方前被拒绝',()=>{
  for(const references of ['invalid',['/uploads/not-resolved.png'],Array.from({length:11},(_,i)=>`https://example.com/${i}.png`)])assert.throws(()=>buildChatMessages({prompt:'看图',references}));
});
