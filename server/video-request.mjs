export const videoDimensions=(ratio,resolution)=>{
 const sizes={
  '480p':{'16:9':[854,480],'9:16':[480,854],'1:1':[480,480],'4:3':[640,480],'3:4':[480,640]},
  '720p':{'16:9':[1280,720],'9:16':[720,1280],'1:1':[720,720],'4:3':[960,720],'3:4':[720,960]},
  '768p':{'16:9':[1366,768],'9:16':[768,1366],'1:1':[768,768],'4:3':[1024,768],'3:4':[768,1024]},
  '1080p':{'16:9':[1920,1080],'9:16':[1080,1920],'1:1':[1080,1080],'4:3':[1440,1080],'3:4':[1080,1440]},
 };
 const [width,height]=sizes[resolution]?.[ratio]||sizes['720p']['16:9'];
 return {width,height};
};

// Agnes 2.5's keyframe and reference modes are mutually exclusive.
// Local images must first resolve to a provider-accessible URL.
export function buildVideoRequest(model,prompt,settings={}){
 if(!model.startsWith('agnes-video-2.5'))return {model,prompt,...(settings.firstFrameUrl?{image:settings.firstFrameUrl}:{}),...videoDimensions(settings.ratio||'16:9',settings.resolution||'720p'),num_frames:Math.min(441,(Number(settings.duration)||5)*24+1),frame_rate:24};
 const duration=Number(settings.duration)||5;
 if(!Number.isInteger(duration)||duration<4||duration>12)throw new Error(`所选 Agnes Video 2.5 仅支持 4–12 秒，当前镜头为 ${duration} 秒。请修改镜头时长或接入原项目模型。`);
 const references=settings.references||[];
 const first=settings.firstFrameUrl;const last=settings.lastFrameUrl;
 if(references.length&&last)throw new Error('Agnes Video 2.5 的参考图模式与首尾帧模式不能同时使用，请选择一种。');
 const images=[...(first?[first]:[]),...references];
 const limit=model.endsWith('flash')?5:8;
 if(images.length>limit)throw new Error(`所选视频模型最多支持 ${limit} 张参考图，当前有 ${images.length} 张。`);
 for(const url of [...images,...(last?[last]:[])])if(typeof url!=='string'||!/^https:\/\//.test(url))throw new Error('Agnes Video 2.5 需要可公开访问的 HTTPS 参考图地址。请配置 GENERATION_MEDIA_BASE_URL 或使用提供方返回的图片地址。');
 const mode=references.length?'reference':first||last?'keyframe':'text';
 return {model,prompt:mode==='reference'?prompt.replace(/@图\s*(\d+)/g,'<Picture $1>'):prompt,mode,seconds:String(duration),size:model.endsWith('flash')?'720P':settings.resolution==='768p'?'720P':(settings.resolution||'720p').toUpperCase(),aspect_ratio:settings.ratio||'16:9',n:1,
  ...(mode==='reference'?{images}:mode==='keyframe'?{...(first?{first_frame:first}:{}),...(last?{last_frame:last}:{})}:{}),
 };
}
