import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, post, patch } from './api';
import type { Bootstrap, Project, Asset } from './types';
import { skills, works } from './catalog';
export type Overlay={type:string;data?:any};
type StudioContextType={data:Bootstrap;loading:boolean;error:string;refresh:()=>Promise<void>;notify:(text:string,error?:boolean)=>void;open:(type:string,data?:any)=>void;close:()=>void;overlay:Overlay|null;createProject:(name?:string,category?:string,prompt?:string)=>Promise<Project|undefined>;updateProject:(id:string,changes:Partial<Project>)=>Promise<Project>;upload:(files:File[],category?:string,sourceUrls?:string[])=>Promise<Asset[]>;favorite:(id:string)=>Promise<void>};
const initial:Bootstrap={projects:[],assets:[],skills:[],works:[],jobs:[],folders:[],favorites:[],profile:{name:'本地创作者',avatar:'/assets/avatar.jpg',checkedIn:null,credits:0},provider:{configured:false,name:'未配置生成服务'},agentSources:[],notifications:[]};
const StudioContext=createContext<StudioContextType>(null!);
export const useStudio=()=>useContext(StudioContext);
export function StudioProvider({children}:{children:ReactNode}){
 const [data,setData]=useState(initial);const[loading,setLoading]=useState(true);const[error,setError]=useState('');const[overlay,setOverlay]=useState<Overlay|null>(null);const[toasts,setToasts]=useState<{id:number;text:string;error:boolean}[]>([]);const navigate=useNavigate();
 const notify=useCallback((text:string,error=false)=>{const id=Date.now()+Math.random();setToasts(t=>[...t,{id,text,error}]);setTimeout(()=>setToasts(t=>t.filter(v=>v.id!==id)),5500);},[]);
 const refresh=useCallback(async()=>{try{const next=await api<Bootstrap>('/bootstrap');setData({...next,skills:[...next.skills,...skills],works:[...next.works,...works]});setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const close=useCallback(()=>setOverlay(null),[]);const open=useCallback((type:string,data?:any)=>setOverlay({type,data}),[]);
 const updateProject=useCallback(async(id:string,changes:Partial<Project>)=>{const p=await patch<Project>(`/projects/${id}`,changes);setData(d=>({...d,projects:d.projects.map(x=>x.id===id?p:x)}));return p;},[]);
 const createProject=useCallback(async(name='未命名项目',category='自由画布',prompt='')=>{try{let p=await post<Project>('/projects',{name,category});if(prompt)p=await patch<Project>(`/projects/${p.id}`,{messages:[{id:crypto.randomUUID(),role:'user',text:prompt,createdAt:new Date().toISOString()}]});setData(d=>({...d,projects:[p,...d.projects]}));close();navigate(`/space/${p.id}`);return p;}catch(e){notify((e as Error).message,true);}},[close,navigate,notify]);
 const upload=useCallback(async(files:File[],category='其他',sourceUrls?:string[])=>{if(!files.length)return[];const form=new FormData();files.forEach(f=>form.append('files',f));form.append('category',category);if(sourceUrls)form.append('sourceUrls',JSON.stringify(sourceUrls));try{const r=await api<{assets:Asset[]}>('/assets/upload',{method:'POST',body:form});setData(d=>({...d,assets:[...r.assets.filter(asset=>!d.assets.some(existing=>existing.id===asset.id)),...d.assets]}));notify(sourceUrls?'已同步素材到资产库':`已上传 ${r.assets.length} 个素材`);return r.assets;}catch(e){notify((e as Error).message,true);return[];}},[notify]);
 const favorite=useCallback(async(id:string)=>{try{const r=await post('/favorites/'+id,{});setData(d=>({...d,favorites:r.favorites}));}catch(e){notify((e as Error).message,true);}},[notify]);
 return <StudioContext.Provider value={{data,loading,error,refresh,notify,open,close,overlay,createProject,updateProject,upload,favorite}}>{children}<div className="toast-stack" aria-live="polite">{toasts.map(t=><div key={t.id} className={`toast ${t.error?'error':''}`}>{t.text}</div>)}</div></StudioContext.Provider>;
}
