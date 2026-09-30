export type Asset = { id: string; name: string; category: string; url: string; mime: string; size: number; favorite: boolean; trashed: boolean; createdAt: string; description?: string; sourceUrl?: string };
export type CanvasNode = { id: string; type: string; position: { x: number; y: number }; data: { title: string; kind: string; text: string; url?: string; mime?: string; duration?: number; color?: string; model?: string; style?: string; ratio?: string; resolution?: string; firstFrameUrl?: string; lastFrameUrl?: string }; selected?: boolean };
export type CanvasEdge = { id: string; source: string; target: string; type?: string; animated?: boolean };
export type WorkflowNodeAction = { kind: string; title: string; text: string; duration?: number };
export type WorkflowAction =
  | ({ type: 'create_node' } & WorkflowNodeAction)
  | { type: 'create_nodes'; nodes: WorkflowNodeAction[] }
  | { type: 'replace_script' | 'split_storyboard'; script: string }
  | { type: 'focus'; kind: string };
export type WorkflowResult = { actions: WorkflowAction[]; quickReplies?: string[] };
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: string; workflow?: WorkflowResult };
export type Clip = { id: string; assetId?: string; url: string; title: string; mime: string; duration: number; start: number; muted: boolean };
export type Project = { id: string; name: string; category: string; cover: string; favorite: boolean; trashed: boolean; folderId: string | null; createdAt: string; updatedAt: string; nodes: CanvasNode[]; edges: CanvasEdge[]; messages: Message[]; clips: Clip[]; script: string };
export type Skill = { id: string; name: string; description: string; category: string; image: string; instructions: string; custom?: boolean };
export type Job = { id: string; projectId: string; kind: string; prompt: string; model: string; status: string; settings?: Record<string, unknown>; error?: string; outputUrl?: string; text?: string; workflow?: WorkflowResult; createdAt: string };
export type Folder = { id: string; name: string };
export type Profile = { name: string; avatar: string; checkedIn: string | null; credits: number };
export type Work = { id: string; title: string; image: string; category: string; video?: string; description?: string; local?: boolean };
export type AgentKind = 'Agent' | '图文' | '视频' | '音频';
export type AgentAdapter = 'generic' | 'openai-chat' | 'openai-image' | 'openai-video';
export type AgentModel = { id: string; name: string; description: string; badge?: string };
export type AgentDataSource = {
  id: string;
  kind: AgentKind;
  name: string;
  endpoint: string;
  adapter: AgentAdapter;
  enabled: boolean;
  defaultModel: string;
  models: AgentModel[];
  apiKeyConfigured: boolean;
  updatedAt?: string;
};
export type Bootstrap = {
  projects: Project[];
  assets: Asset[];
  skills: Skill[];
  jobs: Job[];
  folders: Folder[];
  favorites: string[];
  profile: Profile;
  works: Work[];
  provider: { configured: boolean; name: string };
  agentSources: AgentDataSource[];
  notifications: { id: string; title: string; text: string; read: boolean }[];
};
