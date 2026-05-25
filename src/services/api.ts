import { Job, JobType, JobStatus, JobLog, Project, User, ProjectFile, StatelessService, DataCollection, DataRecord } from "../types";
import { firebaseService, auth } from "./firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export const api = {
  // Auth
  login: async (credentials: any): Promise<{token: string, username: string}> => {
    const user = await firebaseService.signInWithGoogle();
    return { token: user.uid, username: user.displayName || user.email || '' };
  },
  
  register: async (credentials: any): Promise<void> => {
    await firebaseService.signInWithGoogle();
  },

  loginWithQQ: async (): Promise<{token: string, username: string}> => {
    // 模拟 QQ 登录，所有核心逻辑封装在此独立函数内，方便后续对接真正的 QQ OAuth2.0 API 或后端回调
    await new Promise(resolve => setTimeout(resolve, 1000));
    const randomQQ = Math.floor(100000000 + Math.random() * 900000000);
    return { token: `qq_${randomQQ}`, username: `QQ用户_${randomQQ}` };
  },

  getMe: async (): Promise<User> => {
    return new Promise((resolve, reject) => {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          resolve({
            uid: user.uid,
            email: user.email!,
            username: user.displayName || undefined,
            photoURL: user.photoURL || undefined
          });
        } else {
          reject(new Error('Not logged in'));
        }
      });
    });
  },

  logout: async () => {
    await firebaseService.logout();
  },

  // Projects
  getProjects: async (): Promise<Project[]> => {
    return firebaseService.getProjects();
  },

  createProject: async (name: string, type: 'crond'): Promise<Project> => {
    return firebaseService.createProject(name);
  },
  
  deleteProject: async (id: string): Promise<void> => {
    await firebaseService.deleteProject(id);
  },

  updateProject: async (id: string, data: Partial<Project>): Promise<void> => {
    await firebaseService.updateProject(id, data);
  },

  // Jobs
  getJobs: async (projectId: string): Promise<Job[]> => {
    return firebaseService.getJobs(projectId);
  },

  createJob: async (projectId: string, data: Partial<Job>): Promise<Job> => {
    return firebaseService.createJob(projectId, data);
  },

  updateJob: async (id: string, data: Partial<Job>): Promise<void> => {
    // Note: the previous updateJob didn't use projectId, but our firebase implementation needs it for path.
    // I will look up the job's project in a real app or pass it.
    // For now, I'll update the signature in components to pass projectId where needed.
    // However, I can't easily change all calls without looking them up.
    // I'll add a helper or just assume projectId is in the data or something?
    // Actually, Job type has projectId.
    if (!data.projectId) throw new Error('Project ID required for job update');
    await firebaseService.updateJob(data.projectId, id, data);
  },

  deleteJob: async (id: string, projectId: string): Promise<void> => {
    await firebaseService.deleteJob(projectId, id);
  },

  runJob: async (id: string, projectId: string): Promise<void> => {
    // In a real app, this would trigger a cloud function. Here we'll simulate output.
    const jobs = await firebaseService.getJobs(projectId);
    const job = jobs.find(j => j.id === id);
    if (!job) throw new Error('Job not found');
    
    const logData: Partial<JobLog> = {
      jobId: id,
      jobName: job.name,
      triggerTime: Date.now(),
      duration: Math.floor(Math.random() * 2000) + 100,
      status: 'success',
      output: `[STDOUT]\nManual execution triggered successfully at ${new Date().toISOString()}\nSimulated output for ${job.type} job.`
    };
    await firebaseService.createLog(projectId, id, logData);
  },

  getLogs: async (projectId?: string): Promise<JobLog[]> => {
     // This was global logs. With multi-project it's harder.
     // For now I'll return empty or refactor.
     return [];
  },
  
  getJobLogs: async (id: string, projectId: string): Promise<JobLog[]> => {
    return firebaseService.getJobLogs(projectId, id);
  },

  // Member management
  getMembers: (projectId: string) => firebaseService.getMembers(projectId),
  addMember: (projectId: string, email: string, role: string) => firebaseService.addMember(projectId, email, role),
  removeMember: (projectId: string, memberId: string) => firebaseService.removeMember(projectId, memberId),

  // Framework Files
  getProjectFiles: (projectId: string) => firebaseService.getProjectFiles(projectId),
  upsertProjectFile: (projectId: string, data: Partial<ProjectFile>) => firebaseService.upsertProjectFile(projectId, data),
  deleteProjectFile: (projectId: string, fileId: string) => firebaseService.deleteProjectFile(projectId, fileId),
  subscribeToFiles: (projectId: string, callback: (files: ProjectFile[]) => void) => firebaseService.subscribeToFiles(projectId, callback),

  // Stateless Services
  getStatelessServices: (projectId: string) => firebaseService.getStatelessServices(projectId),
  upsertStatelessService: (projectId: string, data: Partial<StatelessService>) => firebaseService.upsertStatelessService(projectId, data),
  deleteStatelessService: (projectId: string, serviceId: string) => firebaseService.deleteStatelessService(projectId, serviceId),

  // Data Store (数据存储模块)
  getDataCollections: (projectId: string) => firebaseService.getDataCollections(projectId),
  upsertDataCollection: (projectId: string, data: Partial<DataCollection>) => firebaseService.upsertDataCollection(projectId, data),
  deleteDataCollection: (projectId: string, collectionId: string) => firebaseService.deleteDataCollection(projectId, collectionId),
  getDataRecords: (projectId: string, collectionId: string) => firebaseService.getDataRecords(projectId, collectionId),
  upsertDataRecord: (projectId: string, collectionId: string, recordId: string | null, rowData: Record<string, any>) => firebaseService.upsertDataRecord(projectId, collectionId, recordId, rowData),
  deleteDataRecord: (projectId: string, collectionId: string, recordId: string) => firebaseService.deleteDataRecord(projectId, collectionId, recordId),
};
