import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp,
  addDoc,
  serverTimestamp,
  collectionGroup
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { User, Project, ProjectMember, Job, JobLog, ProjectFile, StatelessService, DataCollection, DataRecord } from '../types';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cleanPayload<T extends object>(payload: T): T {
  const clean: any = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

export const firebaseService = {
  // Auth
  signInWithGoogle: async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Sync user profile
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        username: user.displayName,
        photoURL: user.photoURL
      }, { merge: true });

      return user;
    } catch (error) {
      console.error('Auth Error:', error);
      throw error;
    }
  },

  logout: () => signOut(auth),

  // Projects
  getProjects: async (): Promise<Project[]> => {
    if (!auth.currentUser) return [];
    
    try {
      const uid = auth.currentUser.uid;
      
      // Projects where I am owner
      const ownerQuery = query(collection(db, 'projects'), where('ownerId', '==', uid));
      const ownerSnap = await getDocs(ownerQuery);
      const ownerProjects = ownerSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project));
      
      // Projects where I am a member (using collectionGroup for members)
      const memberQuery = query(collectionGroup(db, 'members'), where('userId', '==', uid));
      const memberSnap = await getDocs(memberQuery);
      
      const memberProjectIds = memberSnap.docs.map(d => d.data().projectId);
      const memberProjects: Project[] = [];
      
      for (const pid of memberProjectIds) {
        if (ownerProjects.some(p => p.id === pid)) continue; // Skip if already an owner
        const pdoc = await getDoc(doc(db, 'projects', pid));
        if (pdoc.exists()) {
          memberProjects.push({ id: pdoc.id, ...pdoc.data() } as Project);
        }
      }
      
      return [...ownerProjects, ...memberProjects].sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'projects');
      return [];
    }
  },

  createProject: async (name: string): Promise<Project> => {
    if (!auth.currentUser) throw new Error('Unauthorized');
    
    try {
      const projectData = {
        name,
        type: 'crond',
        ownerId: auth.currentUser.uid,
        createdAt: Date.now()
      };
      
      const docRef = await addDoc(collection(db, 'projects'), projectData);
      return { id: docRef.id, ...projectData } as Project;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
      throw error;
    }
  },

  updateProject: async (projectId: string, data: Partial<Project>) => {
    try {
      await updateDoc(doc(db, 'projects', projectId), cleanPayload({ ...data }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      await deleteDoc(doc(db, 'projects', projectId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}`);
    }
  },

  // Members
  getMembers: async (projectId: string): Promise<ProjectMember[]> => {
    try {
      const snap = await getDocs(collection(db, `projects/${projectId}/members`));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectMember));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/members`);
      return [];
    }
  },

  addMember: async (projectId: string, userEmail: string, role: string) => {
    try {
      const usersQuery = query(collection(db, 'users'), where('email', '==', userEmail));
      const usersSnap = await getDocs(usersQuery);
      
      if (usersSnap.empty) {
        throw new Error('User not found. They must login to the app first.');
      }
      
      const user = usersSnap.docs[0].data();
      const memberRef = doc(db, `projects/${projectId}/members`, user.uid);
      await setDoc(memberRef, {
        projectId,
        userId: user.uid,
        userEmail: user.email,
        role
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/members`);
    }
  },

  removeMember: async (projectId: string, memberId: string) => {
    try {
      await deleteDoc(doc(db, `projects/${projectId}/members`, memberId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/members/${memberId}`);
    }
  },

  // Jobs
  getJobs: async (projectId: string): Promise<Job[]> => {
    try {
      const q = query(collection(db, `projects/${projectId}/jobs`), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Job));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/jobs`);
      return [];
    }
  },

  createJob: async (projectId: string, data: Partial<Job>): Promise<Job> => {
    try {
      const jobData = {
        projectId,
        name: data.name || 'Untitled',
        cronExp: data.cronExp || '* * * * *',
        type: data.type,
        content: data.content || '',
        status: data.status || 'active',
        createdAt: Date.now()
      };
      const docRef = await addDoc(collection(db, `projects/${projectId}/jobs`), jobData);
      return { id: docRef.id, ...jobData } as Job;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/jobs`);
      throw error;
    }
  },

  updateJob: async (projectId: string, jobId: string, data: Partial<Job>) => {
    try {
      await updateDoc(doc(db, `projects/${projectId}/jobs`, jobId), cleanPayload({ ...data }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}/jobs/${jobId}`);
    }
  },

  deleteJob: async (projectId: string, jobId: string) => {
    try {
      await deleteDoc(doc(db, `projects/${projectId}/jobs`, jobId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/jobs/${jobId}`);
    }
  },

  // Logs
  getJobLogs: async (projectId: string, jobId: string): Promise<JobLog[]> => {
    try {
      const q = query(collection(db, `projects/${projectId}/jobs/${jobId}/logs`), orderBy('triggerTime', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as JobLog));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/jobs/${jobId}/logs`);
      return [];
    }
  },

  createLog: async (projectId: string, jobId: string, logData: Partial<JobLog>) => {
    try {
      await addDoc(collection(db, `projects/${projectId}/jobs/${jobId}/logs`), cleanPayload({ ...logData }));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/jobs/${jobId}/logs`);
    }
  },

  // Framework Files
  getProjectFiles: async (projectId: string): Promise<ProjectFile[]> => {
    try {
      const q = query(collection(db, `projects/${projectId}/framework-files`), orderBy('updatedAt', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectFile));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/framework-files`);
      return [];
    }
  },

  upsertProjectFile: async (projectId: string, fileData: Partial<ProjectFile>): Promise<ProjectFile> => {
    try {
      const data = cleanPayload({
        ...fileData,
        projectId,
        updatedAt: Date.now()
      });
      
      if (fileData.id) {
        await updateDoc(doc(db, `projects/${projectId}/framework-files`, fileData.id), data);
        return { ...data } as ProjectFile;
      } else {
        const docRef = await addDoc(collection(db, `projects/${projectId}/framework-files`), data);
        return { id: docRef.id, ...data } as ProjectFile;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/framework-files`);
      throw error;
    }
  },

  deleteProjectFile: async (projectId: string, fileId: string) => {
    try {
      await deleteDoc(doc(db, `projects/${projectId}/framework-files`, fileId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/framework-files/${fileId}`);
    }
  },

  subscribeToFiles: (projectId: string, callback: (files: ProjectFile[]) => void) => {
    const q = query(collection(db, `projects/${projectId}/framework-files`), orderBy('updatedAt', 'asc'));
    return onSnapshot(q, (snap) => {
      const files = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectFile));
      callback(files);
    }, (error) => {
      console.error('Files Subscription Error:', error);
    });
  },

  // Stateless Services
  getStatelessServices: async (projectId: string): Promise<StatelessService[]> => {
    try {
      const q = query(collection(db, `projects/${projectId}/stateless-services`), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as StatelessService));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/stateless-services`);
      return [];
    }
  },

  upsertStatelessService: async (projectId: string, serviceData: Partial<StatelessService>): Promise<StatelessService> => {
    try {
      const data = cleanPayload({
        ...serviceData,
        projectId,
        createdAt: serviceData.createdAt || Date.now()
      });
      
      if (serviceData.id) {
        await updateDoc(doc(db, `projects/${projectId}/stateless-services`, serviceData.id), data);
        return { ...data } as StatelessService;
      } else {
        const docRef = await addDoc(collection(db, `projects/${projectId}/stateless-services`), cleanPayload({
          ...data,
          status: 'active'
        }));
        return { id: docRef.id, ...data, status: 'active' } as StatelessService;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/stateless-services`);
      throw error;
    }
  },

  deleteStatelessService: async (projectId: string, serviceId: string) => {
    try {
      await deleteDoc(doc(db, `projects/${projectId}/stateless-services`, serviceId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/stateless-services/${serviceId}`);
    }
  },

  // Data Collections (数据存储模块 - 集合)
  getDataCollections: async (projectId: string): Promise<DataCollection[]> => {
    try {
      const q = query(collection(db, `projects/${projectId}/data-collections`), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as DataCollection));
      
      // If empty, return initial mock collections for demonstration
      if (list.length === 0) {
        return [
          {
            id: 'mock_users',
            projectId,
            name: 'users',
            displayName: '用户主表 (users)',
            description: '外部无状态服务与定时任务调用的核心用户信息表',
            createdAt: Date.now() - 100000
          },
          {
            id: 'mock_configs',
            projectId,
            name: 'system_configs',
            displayName: '系统全局配置 (system_configs)',
            description: '存储微服务运行期间所需的动态开关与数值参数',
            createdAt: Date.now() - 200000
          },
          {
            id: 'mock_api_logs',
            projectId,
            name: 'api_logs',
            displayName: '接口调用日志 (api_logs)',
            description: '无状态服务被请求时自动落库的异步访问审计流水',
            createdAt: Date.now() - 300000
          }
        ];
      }
      return list;
    } catch (error) {
      console.warn('Firestore getDataCollections error, falling back to mock data:', error);
      return [
        {
          id: 'mock_users',
          projectId,
          name: 'users',
          displayName: '用户主表 (users)',
          description: '外部无状态服务与定时任务调用的核心用户信息表',
          createdAt: Date.now() - 100000
        },
        {
          id: 'mock_configs',
          projectId,
          name: 'system_configs',
          displayName: '系统全局配置 (system_configs)',
          description: '存储微服务运行期间所需的动态开关与数值参数',
          createdAt: Date.now() - 200000
        },
        {
          id: 'mock_api_logs',
          projectId,
          name: 'api_logs',
          displayName: '接口调用日志 (api_logs)',
          description: '无状态服务被请求时自动落库的异步访问审计流水',
          createdAt: Date.now() - 300000
        }
      ];
    }
  },

  upsertDataCollection: async (projectId: string, collectionData: Partial<DataCollection>): Promise<DataCollection> => {
    try {
      const data = cleanPayload({
        ...collectionData,
        projectId,
        createdAt: collectionData.createdAt || Date.now()
      });
      
      if (collectionData.id && !collectionData.id.startsWith('mock_')) {
        await updateDoc(doc(db, `projects/${projectId}/data-collections`, collectionData.id), data);
        return { ...data } as DataCollection;
      } else {
        const docRef = await addDoc(collection(db, `projects/${projectId}/data-collections`), data);
        return { id: docRef.id, ...data } as DataCollection;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/data-collections`);
      throw error;
    }
  },

  deleteDataCollection: async (projectId: string, collectionId: string): Promise<void> => {
    try {
      if (collectionId.startsWith('mock_')) {
        return;
      }
      await deleteDoc(doc(db, `projects/${projectId}/data-collections`, collectionId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/data-collections/${collectionId}`);
    }
  },

  // Data Records (数据存储模块 - 集合内的文档数据)
  getDataRecords: async (projectId: string, collectionId: string): Promise<DataRecord[]> => {
    try {
      const q = query(collection(db, `projects/${projectId}/data-collections/${collectionId}/records`), orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as DataRecord));
      
      if (list.length === 0) {
        if (collectionId === 'mock_users') {
          return [
            {
              id: 'rec_u1',
              collectionId,
              projectId,
              data: { key: "user_xm", username: '张晓明', email: 'xiaoming@example.com', role: 'admin', age: 28, status: 'active', balance: 500.0, lastLogin: '2026-05-20 12:45:00' },
              updatedAt: Date.now() - 50000
            },
            {
              id: 'rec_u2',
              collectionId,
              projectId,
              data: { key: "user_ss", username: '李诗诗', email: 'shishi@example.com', role: 'member', age: 24, status: 'active', balance: 1250.5, lastLogin: '2026-05-19 14:12:11' },
              updatedAt: Date.now() - 150000
            },
            {
              id: 'rec_u3',
              collectionId,
              projectId,
              data: { key: "user_andy", username: 'Andy Cheng', email: 'andy@example.com', role: 'editor', age: 31, status: 'suspended', balance: 0.0, lastLogin: '2026-05-21 08:30:25' },
              updatedAt: Date.now() - 250000
            }
          ];
        } else if (collectionId === 'mock_configs') {
          return [
            {
              id: 'rec_c1',
              collectionId,
              projectId,
              data: { key: "enable_new_user_registration", config_key: 'enable_new_user_registration', value: true, type: 'boolean', group: 'security', last_updated_by: 'admin_sys' },
              updatedAt: Date.now() - 60000
            },
            {
              id: 'rec_c2',
              collectionId,
              projectId,
              data: { key: "maintenance_mode_status", config_key: 'maintenance_mode_status', value: false, type: 'boolean', group: 'maintenance', last_updated_by: 'crond_process' },
              updatedAt: Date.now() - 160000
            },
            {
              id: 'rec_c3',
              collectionId,
              projectId,
              data: { key: "max_stateless_timeout_ms", config_key: 'max_stateless_timeout_ms', value: 15000, type: 'number', group: 'network', last_updated_by: 'dev_user' },
              updatedAt: Date.now() - 260000
            }
          ];
        } else if (collectionId === 'mock_api_logs') {
          return [
            {
              id: 'rec_l1',
              collectionId,
              projectId,
              data: { key: "log_req_89ab32", request_id: 'req_89ab32', endpoint: '/api/v1/user/profile', method: 'GET', ip: '192.168.1.104', status: 200, execution_ms: 12, client: 'ios-app' },
              updatedAt: Date.now() - 70000
            },
            {
              id: 'rec_l2',
              collectionId,
              projectId,
              data: { key: "log_req_22dc15", request_id: 'req_22dc15', endpoint: '/api/v1/auth/token', method: 'POST', ip: '112.54.34.88', status: 401, execution_ms: 220, client: 'browser' },
              updatedAt: Date.now() - 170000
            },
            {
              id: 'rec_l3',
              collectionId,
              projectId,
              data: { key: "log_fd4452", request_id: 'rec_fd4452', endpoint: '/api/v1/configs/sync', method: 'POST', ip: '127.0.0.1', status: 200, execution_ms: 38, client: 'local-jobs' },
              updatedAt: Date.now() - 270000
            }
          ];
        }
      }
      return list;
    } catch (error) {
      console.warn('Firestore getDataRecords error, falling back to mock data:', error);
      if (collectionId === 'mock_users') {
        return [
          {
            id: 'rec_u1',
            collectionId,
            projectId,
            data: { key: "user_xm", username: '张晓明', email: 'xiaoming@example.com', role: 'admin', age: 28, status: 'active', balance: 500.0, lastLogin: '2026-05-20 12:45:00' },
            updatedAt: Date.now() - 50000
          },
          {
            id: 'rec_u2',
            collectionId,
            projectId,
            data: { key: "user_ss", username: '李诗诗', email: 'shishi@example.com', role: 'member', age: 24, status: 'active', balance: 1250.5, lastLogin: '2026-05-19 14:12:11' },
            updatedAt: Date.now() - 150000
          },
          {
            id: 'rec_u3',
            collectionId,
            projectId,
            data: { key: "user_andy", username: 'Andy Cheng', email: 'andy@example.com', role: 'editor', age: 31, status: 'suspended', balance: 0.0, lastLogin: '2026-05-21 08:30:25' },
            updatedAt: Date.now() - 250000
          }
        ];
      } else if (collectionId === 'mock_configs') {
        return [
          {
            id: 'rec_c1',
            collectionId,
            projectId,
            data: { key: 'enable_new_user_registration', config_key: 'enable_new_user_registration', value: true, type: 'boolean', group: 'security', last_updated_by: 'admin_sys' },
            updatedAt: Date.now() - 60000
          },
          {
            id: 'rec_c2',
            collectionId,
            projectId,
            data: { key: 'maintenance_mode_status', config_key: 'maintenance_mode_status', value: false, type: 'boolean', group: 'maintenance', last_updated_by: 'crond_process' },
            updatedAt: Date.now() - 160000
          },
          {
            id: 'rec_c3',
            collectionId,
            projectId,
            data: { key: 'max_stateless_timeout_ms', config_key: 'max_stateless_timeout_ms', value: 15000, type: 'number', group: 'network', last_updated_by: 'dev_user' },
            updatedAt: Date.now() - 260000
          }
        ];
      } else if (collectionId === 'mock_api_logs') {
        return [
          {
            id: 'rec_l1',
            collectionId,
            projectId,
            data: { key: 'req_89ab32', request_id: 'req_89ab32', endpoint: '/api/v1/user/profile', method: 'GET', ip: '192.168.1.104', status: 200, execution_ms: 12, client: 'ios-app' },
            updatedAt: Date.now() - 70000
          },
          {
            id: 'rec_l2',
            collectionId,
            projectId,
            data: { key: 'req_22dc15', request_id: 'req_22dc15', endpoint: '/api/v1/auth/token', method: 'POST', ip: '112.54.34.88', status: 401, execution_ms: 220, client: 'browser' },
            updatedAt: Date.now() - 170000
          },
          {
            id: 'rec_l3',
            collectionId,
            projectId,
            data: { key: 'req_fd4452', request_id: 'rec_fd4452', endpoint: '/api/v1/configs/sync', method: 'POST', ip: '127.0.0.1', status: 200, execution_ms: 38, client: 'local-jobs' },
            updatedAt: Date.now() - 270000
          }
        ];
      }
      return [];
    }
  },

  upsertDataRecord: async (projectId: string, collectionId: string, recordId: string | null, rowData: Record<string, any>): Promise<DataRecord> => {
    try {
      const data = {
        collectionId,
        projectId,
        data: cleanPayload(rowData),
        updatedAt: Date.now()
      };
      
      if (recordId && !recordId.startsWith('rec_')) {
        await updateDoc(doc(db, `projects/${projectId}/data-collections/${collectionId}/records`, recordId), data);
        return { id: recordId, ...data } as DataRecord;
      } else {
        const docRef = await addDoc(collection(db, `projects/${projectId}/data-collections/${collectionId}/records`), data);
        return { id: docRef.id, ...data } as DataRecord;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/data-collections/${collectionId}/records`);
      throw error;
    }
  },

  deleteDataRecord: async (projectId: string, collectionId: string, recordId: string): Promise<void> => {
    try {
      if (recordId.startsWith('rec_')) {
        return;
      }
      await deleteDoc(doc(db, `projects/${projectId}/data-collections/${collectionId}/records`, recordId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/data-collections/${collectionId}/records/${recordId}`);
    }
  }
};
