import type { Skill, Work } from './types';
export const industries = ['个人/自媒体', '短漫剧', 'MV', '游戏', '电商', '广告'];
export const shortcuts = [
  ['自由画布','自由画布','canvas'], ['剧情故事创作','剧情故事创作','story'], ['爆款复刻','爆款复刻','remix'],
  ['故事板做视频','故事板做视频','board'], ['角色设计','角色设计','character'], ['场景设计','场景设计','scene'],
  ['Gif 动画设计','Gif小动画设计','gif'], ['AI 3D 预演台','AI 3D 预演台','stage'],
];
export const modelGroups: Record<string, {name:string;description:string;badge?:string}[]> = {
  图片: [
    {name:'Oii Image 2.5 Fast',description:'高性能，快速出图，图像编辑力提升',badge:'New'},
    {name:'Oii Image 2.5 Pro',description:'高精度，顶级质感，参考图保持更稳定',badge:'Best'},
    {name:'Oii Image 2',description:'超强文字控制，真实感强'},
    {name:'Seedream 5.0 Pro',description:'精准图层编辑，原生多语言直出'},
    {name:'HunYuan Image 3.5',description:'改图精准，质感真实',badge:'New'},
    {name:'Oii N Pro',description:'综合生图能力最好'},
    {name:'Oii Style v8.2',description:'美学飞跃，个性化更懂你',badge:'New'},
    {name:'OII Story AI 5.0',description:'擅长 ACG 风格，提示词理解力强',badge:'New'},
    {name:'Oii N 2',description:'速度快，综合生图'}, {name:'Oii Style v8.1',description:'真实感与美感，一步到位'},
    {name:'Seedream 5.0',description:'轻量智绘，高速出图'}, {name:'Oii Style niji7',description:'动漫美学，无角色参考'},
    {name:'Oii Style niji6',description:'动漫美学'}, {name:'OII Story AI',description:'动漫和插画风格'},
    {name:'Seedream 4.5',description:'默认 2K，亚洲人审美'},
  ],
  视频: [
    {name:'Seedance 2.5',description:'30 秒长镜头，精准控帧',badge:'New'},
    {name:'Seedance2.0 pro',description:'强大模型升级 4K 生成体验'},
    {name:'Metaso-H3',description:'秘塔 H3，多参模型',badge:'New'},
    {name:'MiniMax H3 Max Turbo',description:'更快、更便宜，出片效率起飞',badge:'New'},
    {name:'MiniMax H3 Max',description:'快、秒级出片'}, {name:'MiniMax-H3',description:'超强编辑能力'},
    {name:'Wan 3.0',description:'超高一致性，可生 30 秒',badge:'New'},
    {name:'Seedance2.0 mini',description:'又快又省'}, {name:'Seedance2.0 fast',description:'性价比优选'},
    {name:'Oii Imagine 15',description:'超精细画质'}, {name:'HappyHorse1.1',description:'角色稳定，音画流畅'},
    {name:'Oii Omini',description:'多参输入'}, {name:'Vidu Q3 Mix',description:'多参增强，音画同出'},
    {name:'Wan 2.7',description:'画质升级，智能切镜'}, {name:'Vidu Q3 Ref',description:'参考一致性'},
    {name:'Kling V3 Omni',description:'多元参考，CG / 写实'}, {name:'Vidu Q3 Pro',description:'高质量运镜'},
    {name:'Kling 3.0 std',description:'3D / 写实内容'}, {name:'Kling O1',description:'多元素参考'},
  ],
  音频: [{name:'Seed Audio 1.0',description:'长时音色一致，影视级音频'}, {name:'Oii Music',description:'文字生歌曲，真人质感演唱'}],
};
const skillRows = [
  ['产品广告MG导演','广告营销','将产品、品牌资产、网页、UI、照片、口播或现有视频制作成 MG 广告短片。'],
  ['零食电商广告','广告营销','黄金 3 秒吸睛、多平台策略定制、短视频脚本与分镜设计。'],
  ['武打动作与特效导演技能','短漫剧','把动作想法转化为文字剧本、角色设计和分镜故事板。'],
  ['GTA 风格短片','游戏','将日常小事演绎成荒诞幽默的游戏任务。'],
  ['Vox-inspired拼贴视频','自媒体','锁定叙事与视觉，制作拼贴解释视频或广告。'],
  ['口播扁平插画','自媒体','根据原声或脚本制作手绘搭建动画。'],
  ['3C拆解悬浮展示','广告营销','精密科技产品的爆炸式分层悬浮展示。'],
  ['女装穿搭带货展示视频','广告营销','一致性换装定妆照与服装展示短片。'],
  ['快速买量视频','游戏','15 / 30 / 60 秒游戏信息流广告。'],
  ['3A游戏CG概念片制作skill','游戏','剧本拆解、电影级 CG 分镜与 3D 资产规划。'],
  ['果冻捏捏','周边设计','Q 版草图、透明袋装潮玩与动态展示。'],
  ['铁盒摇摇乐','周边设计','低模角色魔法铁盒与摇晃解压视频。'],
  ['毛毡IP接力变身动态海报','周边设计','毛毡材质与接力变身的品牌视觉。'],
  ['科技发布会风IP广告营销','广告营销','以角色 IP 制作科技宣传短片。'],
  ['梦核风第一人称探险短片','自媒体','千禧年代梦核风格，第一人称 DV 探险。'],
  ['人物表情提示词生成助手','短漫剧','根据人物情境生成精细化表情提示词。'],
  ['视频智能配乐大师 (BGM Matcher)','自媒体','为画面情绪与节奏匹配背景音乐。'],
  ['批量视频助手','自媒体','批量组织分镜素材、视频提示词与任务。'],
  ['动作板','短漫剧','多个姿势整合，规划连续动作。'],
  ['TVC短片广告','广告营销','10 至 30 秒的品牌广告短片。'],
  ['封面设计','自媒体','视频内容封面设计。'],
  ['故事板做视频','短漫剧','将故事板作为视频创作参考。'],
  ['剧情故事创作','短漫剧','从故事构思到剧本、角色、场景和分镜。'],
  ['角色设计','短漫剧','角色设定、选角与三视图。'],
  ['场景设计','短漫剧','创作场景主图与多视角。'],
  ['Gif小动画设计','周边设计','设计简洁流畅的循环动画。'],
  ['爆款复刻','自媒体','拆解参考视频的结构、镜头与节奏。'],
  ['游戏亮点与爽点提炼','游戏','提炼玩法与玩家可感知的爽点。'],
];
export const skills: Skill[] = skillRows.map(([name,category,description],i)=>({id:`skill-${i}`, name, category, description, instructions:`你是${name}。请根据用户的需求规划素材、创意、剧本和分镜。每一个阶段都先提供可编辑方案并等待确认。`,image:`/assets/skill-${i < 17 ? i : i % 17}.jpg`}));
export const works: Work[] = ['同锅','山河无恙','淞沪会战','热血南洋子弟','我的前半生之默片版'].map((title,i)=>({id:`work-${i}`, title, image:`/assets/work-${i}.webp`,category:'个人/自媒体',description:'原站公开作品封面，仅用作本地界面对照。'}));
export const styleNames = ['古风3D漫剧','日系治愈','科学修仙','怀旧记忆','民国诡事','欧美三渲二','末日丧尸','国风泥偶动画','国风仙侠','3D种田','3D机甲','3D言情','80年代','西方宫廷','欧美奇幻','欧美兽人','欧美都市','AI真人(建议垫图)','美式复古动画','水果人','怀旧火线','3D玄幻','现代都市','上海美术电影'];
export const templates = [
  {name:'电影感长镜头',category:'运镜',prompt:'以电影级光影呈现主体。镜头缓慢推进，由全景过渡至中景，保持角色一致性，环境细节自然流动。'},
  {name:'角色三视图',category:'角色',prompt:'角色设定表，正面、侧面、背面三视图。保持服装、发型和比例一致，纯色背景，清晰轮廓。'},
  {name:'产品悬浮展示',category:'广告',prompt:'产品置于画面中心，零部件分层悬浮，精密材质，柔和轮廓光，镜头环绕展示。'},
  {name:'故事分镜规划',category:'分镜',prompt:'请将以下故事拆分为 6 个镜头，分别列出景别、场景、画面内容、运镜、台词和时长。'},
  {name:'日系治愈短片',category:'剧情',prompt:'夏日午后，小镇车站，风吹过树叶。用温柔的色彩讲述一段重逢的故事。'},
  {name:'音乐视频脚本',category:'MV',prompt:'根据歌曲情绪和节拍设计音乐视频，明确主视觉、段落变化和高潮镜头。'},
];
