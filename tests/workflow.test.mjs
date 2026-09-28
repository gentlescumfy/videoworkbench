import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkflow, sanitizeWorkflow, splitStoryboard } from '../server/workflow.mjs';

test('extracts an assistant reply, canvas actions, and per-turn choices',()=>{
  const result=extractWorkflow(JSON.stringify({
    reply:'剧本已拆成两个分镜。',
    actions:[{type:'create_nodes',nodes:[
      {kind:'分镜',title:'镜头 1',text:'晨雾中的杂役院',duration:5},
      {kind:'分镜',title:'镜头 2',text:'主角走上演武台',duration:5},
    ]}],
    quickReplies:['满意，请继续','我要修改'],
  }));
  assert.equal(result.text,'剧本已拆成两个分镜。');
  assert.equal(result.workflow.actions[0].nodes.length,2);
  assert.deepEqual(result.workflow.quickReplies,['满意，请继续','我要修改']);
});

test('ignores unknown actions and bounds untrusted workflow data',()=>{
  const result=sanitizeWorkflow({
    actions:[
      {type:'run_shell',command:'echo unsafe'},
      {type:'create_node',kind:'unknown',title:'x'.repeat(200),text:'y'.repeat(51000),duration:9999},
    ],
    quickReplies:['继续'],
  });
  assert.equal(result.actions.length,1);
  assert.equal(result.actions[0].kind,'文本');
  assert.equal(result.actions[0].title.length,160);
  assert.equal(result.actions[0].text.length,50000);
  assert.equal(result.actions[0].duration,3600);
});

test('splits script headings and blank-line separated passages into a bounded list',()=>{
  assert.deepEqual(splitStoryboard('场 1\n开场\n\n镜头 2\n转场'),['场 1\n开场','镜头 2\n转场']);
  assert.equal(splitStoryboard(Array.from({length:110},(_,i)=>`镜头 ${i+1}\n内容`).join('\n\n')).length,100);
});
