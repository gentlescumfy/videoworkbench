import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function createStore(filename) {
  if(filename!==':memory:') mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id))');
  const list=kind=>db.prepare('SELECT json FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(r.json));
  const get=(kind,id)=>{const row=db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.json):null;};
  const put=(kind,data)=>{db.prepare('INSERT INTO records(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,data.id,JSON.stringify(data));return data;};
  const remove=(kind,id)=>db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);
  const update=(kind,id,values)=>{const old=get(kind,id);if(!old)return null;return put(kind,{...old,...values,id,updatedAt:new Date().toISOString()});};
  return {db,list,get,put,remove,update};
}
export function newProject(input={}) {
  const now=new Date().toISOString();
  return {id:randomUUID(),name:input.name||'未命名项目',category:input.category||'自由画布',cover:'',favorite:false,trashed:false,folderId:null,createdAt:now,updatedAt:now,nodes:[],edges:[],messages:[],clips:[],script:'',...input};
}
export function splitScript(script) {
  const blocks=script.split(/\n\s*\n|(?=^镜头\s*\d)|(?=^场\s*\d)/m).map(s=>s.trim()).filter(Boolean).slice(0,100);
  return blocks.map((text,i)=>({id:randomUUID(),type:'studio',position:{x:(i%3)*340,y:Math.floor(i/3)*350},data:{kind:'分镜',title:`镜头 ${i+1}`,text,duration:5}}));
}
