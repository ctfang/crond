import type { Job, JobLog, Project, User, ProjectFile, StatelessService, DataCollection, DataRecord, ProjectMember } from '../types';
import { auth } from './firebase';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

export interface ComposerStatus {
  available: boolean;
  installed: boolean;
  outdated: boolean;
  installedAt: number;
  status: 'idle' | 'running' | 'success' | 'error';
  output: string;
  message?: string;
  command?: string;
}

export interface ExecutionResult {
  output: string;
  status: 'success' | 'error';
  duration: number;
  http?: { status: number; statusText: string; headers: Record<string, string>; data: unknown };
}

export interface CronPreviewResult {
  nextRun: string | null;
  timezone: string;
}

export interface ServiceTestRequest {
  method: string;
  query: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ServiceTestResponse {
  headers: Record<string, string>;
  size: number;
  status: number;
  statusText: string;
  body: string;
  duration: number;
  ok: boolean;
}

async function invokeService(projectId: string, route: string, options: ServiceTestRequest): Promise<ServiceTestResponse> {
  const query = options.query ? `?${options.query}` : '';
  const start = performance.now();
  let response: Response;
  try {
    response = await fetch(`/api${projectPath(projectId)}/invoke${route}${query}`, {
      method: options.method, credentials: 'same-origin', headers: options.headers,
      body: options.method === 'GET' || options.method === 'HEAD' ? undefined : options.body,
    });
    const body = await response.text();
    return { headers: Object.fromEntries(response.headers.entries()), size: new TextEncoder().encode(body).byteLength, status: response.status, statusText: response.statusText, body, duration: Math.round(performance.now() - start), ok: response.ok };
  } catch {
    throw new Error('请求失败，请确认后台服务可用并检查请求方法和请求头');
  }
}

async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error('无法连接 Go 后台，请确认后台服务已启动');
  }
  const text = await response.text();
  let result: any;
  try { result = JSON.parse(text); } catch { result = text; }
  if (!response.ok) throw new Error(result?.error || `后台请求失败 (${response.status})`);
  if (result === null) throw new Error('后台返回格式异常，请确认 Go 服务已启动');
  return result as T;
}

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
const resourcePath = (projectId: string, kind: string, id?: string) => `${projectPath(projectId)}/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
const upsert = <T>(projectId: string, kind: string, data: { id?: string }) => request<T>(resourcePath(projectId, kind, data.id), data.id ? 'PATCH' : 'POST', data);

export const api = {
  login: async (_credentials: unknown): Promise<{ token: string; username: string }> => {
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
    return request('/auth/google', 'POST', { idToken: await user.getIdToken() });
  },
  register: async (credentials: unknown): Promise<void> => { await api.login(credentials); },
  loginWithQQ: async (): Promise<{ token: string; username: string }> => {
    const { url } = await request<{ url: string }>('/auth/qq', 'POST');
    window.location.assign(url);
    return new Promise(() => {});
  },
  loginWithTestAccount: () => request<{ token: string; username: string }>('/auth/test', 'POST'),
  getMe: () => request<User>('/auth/me'),
  previewCron: (cronExp: string) => request<CronPreviewResult>('/cron/preview', 'POST', { cronExp }),
  logout: async () => { await request('/auth/logout', 'POST'); await signOut(auth); },
  getProjects: () => request<Project[]>('/projects'),
  createProject: (name: string, type: 'crond', slug: string) => request<Project>('/projects', 'POST', { name, type, slug }),
  updateProject: (id: string, data: Partial<Project>) => request<Project>(projectPath(id), 'PATCH', data),
  deleteProject: (id: string) => request(projectPath(id), 'DELETE'),
  getJobs: (projectId: string) => request<Job[]>(resourcePath(projectId, 'jobs')),
  createJob: (projectId: string, data: Partial<Job>) => request<Job>(resourcePath(projectId, 'jobs'), 'POST', data),
  updateJob: (id: string, data: Partial<Job>) => {
    if (!data.projectId) throw new Error('缺少项目 ID');
    return request<Job>(resourcePath(data.projectId, 'jobs', id), 'PATCH', data);
  },
  deleteJob: (id: string, projectId: string) => request(resourcePath(projectId, 'jobs', id), 'DELETE'),
  runJob: (id: string, projectId: string) => request<ExecutionResult>(`${resourcePath(projectId, 'jobs', id)}/run`, 'POST'),
  executeJob: (projectId: string, data: Partial<Job>) => request<ExecutionResult>(`${projectPath(projectId)}/execute`, 'POST', data),
  getLogs: (projectId?: string) => projectId ? request<JobLog[]>(`${projectPath(projectId)}/logs`) : Promise.resolve([] as JobLog[]),
  getJobLogs: (id: string, projectId: string) => request<JobLog[]>(`${resourcePath(projectId, 'jobs', id)}/logs`),
  getMembers: (projectId: string) => request<ProjectMember[]>(resourcePath(projectId, 'members')),
  addMember: (projectId: string, email: string, role: string) => request(resourcePath(projectId, 'members'), 'POST', { userEmail: email, role }),
  removeMember: (projectId: string, id: string) => request(resourcePath(projectId, 'members', id), 'DELETE'),
  getComposerStatus: (projectId: string) => request<ComposerStatus>(`${projectPath(projectId)}/composer`),
  getFrameworkFiles: () => request<ProjectFile[]>('/framework'),
  getProjectFiles: (projectId: string) => request<ProjectFile[]>(resourcePath(projectId, 'files')),
  upsertProjectFile: (projectId: string, data: Partial<ProjectFile>) => upsert<ProjectFile>(projectId, 'files', data),
  deleteProjectFile: (projectId: string, id: string) => request(resourcePath(projectId, 'files', id), 'DELETE'),
  subscribeToFiles: (projectId: string, callback: (files: ProjectFile[]) => void) => {
    let stopped = false;
    let pending = false;
    const refresh = async () => {
      if (pending || stopped) return;
      pending = true;
      try { const files = await api.getProjectFiles(projectId); if (!stopped) callback(files); }
      catch (error) { if (!stopped) console.error('文件列表加载失败', error); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  },
  invokeService,
  getStatelessServices: (projectId: string) => request<StatelessService[]>(resourcePath(projectId, 'services')),
  upsertStatelessService: (projectId: string, data: Partial<StatelessService>) => upsert<StatelessService>(projectId, 'services', data),
  deleteStatelessService: (projectId: string, id: string) => request(resourcePath(projectId, 'services', id), 'DELETE'),
  getDataCollections: (projectId: string) => request<DataCollection[]>(resourcePath(projectId, 'collections')),
  upsertDataCollection: (projectId: string, data: Partial<DataCollection>) => upsert<DataCollection>(projectId, 'collections', data),
  deleteDataCollection: (projectId: string, id: string) => request(resourcePath(projectId, 'collections', id), 'DELETE'),
  getDataRecords: (projectId: string, collectionId: string) => request<DataRecord[]>(`${resourcePath(projectId, 'collections', collectionId)}/records`),
  upsertDataRecord: (projectId: string, collectionId: string, recordId: string | null, data: Record<string, unknown>) => request<DataRecord>(`${resourcePath(projectId, 'collections', collectionId)}/records${recordId ? `/${encodeURIComponent(recordId)}` : ''}`, recordId ? 'PATCH' : 'POST', { data }),
  deleteDataRecord: (projectId: string, collectionId: string, recordId: string) => request(`${resourcePath(projectId, 'collections', collectionId)}/records/${encodeURIComponent(recordId)}`, 'DELETE'),
};
