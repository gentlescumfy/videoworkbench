import { useEffect, useRef, useState } from 'react';
import { Eraser, Paintbrush, Redo2, Undo2, X } from 'lucide-react';

export type DrawReference = { id: string; name: string; url: string };
export type DrawImageRequest = { mode: 'image' | 'prop'; prompt: string; ratio: string; references: DrawReference[]; sketch: Blob; style: string };
const propStyles = ['默认','AI真人(建议垫图)','怀旧火线','和平精英','3D乙游','Kpop女团 CG风','欧美CG','小绿鸟插画风','双城风格','卡通小人','给他爱','游戏CG','方块世界','赛博朋克2077','美式真人','荒野大表哥','像素农场','Q版3D','南方公园','动森','吉卜力','毛绒玩具质感','美漫恶搞风','乐高','辛普森','蜡笔小新','航海王','复古掌机','80s年代','柯南风','龙族传说','像素','火柴人','比奇堡','日式少女漫','史努比','复古日式','东方古典装饰','折纸艺术'];
const brushColors = ['#f8f8f8','#e64747','#4169e1','#42b95a','#f2d33d','#ef8c28','#ec45c3','#38c9cc','#6842d9','#de8563'];

export function DrawImageModal({ scenes, characters, busy, mode = 'image', onClose, onGenerate }: {
  mode?: 'image' | 'prop';
  scenes: DrawReference[]; characters: DrawReference[]; busy?: boolean; onClose: () => void;
  onGenerate: (request: DrawImageRequest) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const history = useRef<ImageData[]>([]);
  const future = useRef<ImageData[]>([]);
  const [revision, setRevision] = useState(0);
  const [tool, setTool] = useState<'brush'|'eraser'>('brush');
  const [size, setSize] = useState(8);
  const [color, setColor] = useState('#ed4b4b');
  const [ratio, setRatio] = useState('1:1');
  const [prompt, setPrompt] = useState('');
  const [references, setReferences] = useState<DrawReference[]>([]);
  const [style, setStyle] = useState(propStyles[0]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [w,h] = ratio === '16:9' ? [1600,900] : ratio === '9:16' ? [900,1600] : [1200,1200];
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    if (context) { context.fillStyle = '#f5f5f5'; context.fillRect(0,0,w,h); }
    history.current = []; future.current = []; setRevision(value => value + 1);
  }, [ratio]);

  const snapshot = () => { const canvas=canvasRef.current; if(canvas) history.current.push(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height)); };
  const restore = (image:ImageData) => { const canvas=canvasRef.current; if(canvas) canvas.getContext('2d')!.putImageData(image,0,0); setRevision(value=>value+1); };
  const point = (event:React.PointerEvent<HTMLCanvasElement>) => { const rect=event.currentTarget.getBoundingClientRect(); return {x:(event.clientX-rect.left)*event.currentTarget.width/rect.width,y:(event.clientY-rect.top)*event.currentTarget.height/rect.height}; };
  const start = (event:React.PointerEvent<HTMLCanvasElement>) => { const canvas=event.currentTarget;canvas.setPointerCapture(event.pointerId);snapshot();future.current=[];drawing.current=true;const p=point(event);const ctx=canvas.getContext('2d')!;ctx.globalCompositeOperation=tool==='eraser'?'destination-out':'source-over';ctx.strokeStyle=color;ctx.lineWidth=size*canvas.width/canvas.getBoundingClientRect().width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.1,p.y+.1);ctx.stroke(); };
  const move = (event:React.PointerEvent<HTMLCanvasElement>) => { if(!drawing.current)return;const p=point(event);const ctx=event.currentTarget.getContext('2d')!;ctx.lineTo(p.x,p.y);ctx.stroke(); };
  const stop = () => { drawing.current=false;setRevision(value=>value+1); };
  const undo = () => { const canvas=canvasRef.current;if(!canvas||!history.current.length)return;future.current.push(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height));restore(history.current.pop()!); };
  const redo = () => { const canvas=canvasRef.current;if(!canvas||!future.current.length)return;history.current.push(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height));restore(future.current.pop()!); };
  const clear = () => { const canvas=canvasRef.current;if(!canvas)return;snapshot();future.current=[];const ctx=canvas.getContext('2d')!;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#f5f5f5';ctx.fillRect(0,0,canvas.width,canvas.height);setRevision(value=>value+1); };
  const toggle = (reference:DrawReference) => setReferences(current=>current.some(item=>item.id===reference.id)?current.filter(item=>item.id!==reference.id):[...current,reference]);
  const submit = () => { const canvas=canvasRef.current;if(!canvas||busy)return;if(!window.confirm('生成图片会向已配置的模型提交草图和所选参考图，可能消耗积分。继续吗？'))return;canvas.toBlob(blob=>{if(blob)onGenerate({mode,prompt,ratio,references:mode==='prop'?[]:references,sketch:blob,style:mode==='prop'?style:''});},'image/png'); };
  const title = mode === 'prop' ? '道具绘制' : '手绘生图';
  const preview = mode === 'prop'
    ? `请严格按照图1（草图）中的造型、轮廓和比例来生成一个道具/物品的设计图。\n要求：纯白色背景，道具居中，细节清晰，适合用作游戏或动画中的道具素材。${prompt?`\n\n道具描述：${prompt}`:''}${style!==propStyles[0]?`\n\n风格：${style}`:''}`
    : `请严格按照图1（草图）中的构图、人物位置、姿态和空间布局来生成最终图片。图1是构图蓝图，最终图片中每个元素的位置、大小、姿势必须与草图一致。${prompt&&`\n\n画面描述：${prompt}`}${references.length&&`\n\n角色与场景参考：${references.map(item=>item.name).join('、')}`}\n\n要求：保持每个角色的外观与其参考图一致，不要偏离草图中的构图布局。`;

  return <div className="draw-image-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className={`draw-image-modal ${mode==='prop'?'prop-draw-modal':''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="draw-image-header"><strong>{title}</strong><button aria-label={`关闭${title}`} onClick={onClose}><X size={17}/></button></header>
      <div className="draw-image-workspace">
        <div className="draw-image-board">
          <div className="draw-image-toolbar">
            <button className={tool==='brush'?'active':''} aria-pressed={tool==='brush'} onClick={()=>setTool('brush')}><Paintbrush size={15}/>画笔</button>
            <button className={tool==='eraser'?'active':''} aria-pressed={tool==='eraser'} onClick={()=>setTool('eraser')}><Eraser size={15}/>橡皮擦</button>
            <button aria-label="撤销" disabled={!history.current.length} onClick={undo}><Undo2 size={15}/></button>
            <button aria-label="重做" disabled={!future.current.length} onClick={redo}><Redo2 size={15}/></button>
            <input aria-label="画笔大小" type="range" min="2" max="48" value={size} onChange={event=>setSize(Number(event.target.value))}/><span>{size}</span>
            {mode==='prop'?<div className="draw-image-swatches" aria-label="画笔颜色">{brushColors.map(value=><button key={value} className={color===value?'selected':''} aria-label={`画笔颜色 ${value}`} aria-pressed={color===value} style={{'--swatch':value} as React.CSSProperties} onClick={()=>setColor(value)}/>)}</div>:<label className="draw-image-color" title="画笔颜色"><input aria-label="画笔颜色" type="color" value={color} onChange={event=>setColor(event.target.value)}/></label>}
          </div>
          <div className={`draw-image-canvas-wrap ratio-${ratio.replace(':','-')}`}><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}/></div>
          <footer><span>草图将作为构图参考</span><button className="button small" onClick={clear}>清除画布</button></footer>
        </div>
        <aside className="draw-image-options">
          <fieldset><legend>画面比例</legend><div className="draw-ratios">{['1:1','16:9','9:16'].map(value=><button key={value} className={ratio===value?'active':''} onClick={()=>setRatio(value)}>{value}</button>)}</div></fieldset>
          {mode==='prop'?<><label className="draw-prompt-label">描述<textarea value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="描述道具的特征，如：一把发光的圆形权杖，顶端镶嵌蓝色宝石…"/></label><fieldset><legend>风格</legend><div className="prop-style-grid">{propStyles.map(value=><button key={value} className={style===value?'active':''} aria-pressed={style===value} onClick={()=>setStyle(value)}>{value}</button>)}</div></fieldset></>:<><fieldset><legend>场景背景</legend><div className="draw-reference-list">{scenes.map(reference=><button key={reference.id} className={references.some(item=>item.id===reference.id)?'selected':''} onClick={()=>toggle(reference)}><img src={reference.url} alt=""/><span>{reference.name}</span><small>{references.some(item=>item.id===reference.id)?'已添加':'+ 添加'}</small></button>)}</div></fieldset><fieldset><legend>角色</legend><div className="draw-reference-list">{characters.map(reference=><button key={reference.id} className={references.some(item=>item.id===reference.id)?'selected':''} onClick={()=>toggle(reference)}><img src={reference.url} alt=""/><span>{reference.name}</span><small>{references.some(item=>item.id===reference.id)?'已添加':'+ 添加'}</small></button>)}</div></fieldset><label className="draw-prompt-label">描述<textarea value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="描述你想要的画面效果，如：两人面对面拥抱，在夕阳下…"/></label></>}
          <section className="draw-prompt-preview"><small>PROMPT 预览</small><p>{preview}</p></section>
        </aside>
      </div>
      <footer className="draw-image-footer"><span>{mode==='prop'?`当前风格：${style}`:references.length?`已添加 ${references.length} 张参考图`:''}</span><button className="button primary" disabled={busy} onClick={submit}>{busy?'提交中…':mode==='prop'?'生成道具':'生成图片'}</button></footer>
    </section>
  </div>;
}
