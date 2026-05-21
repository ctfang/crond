export type JobType = "http" | "shell" | "php";
export type JobStatus = "active" | "inactive";

export interface User {
  uid: string;
  email: string;
  username?: string;
  photoURL?: string;
}

export interface Project {
  id: string;
  name: string;
  type: 'crond';
  ownerId: string;
  createdAt: number;
  phpBootstrap?: string;
  entryFileId?: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  path: string; // e.g., "src/Core.php"
  type: 'file' | 'folder';
  content?: string;
  parentId: string | 'root';
  updatedAt: number;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  userEmail: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface Job {
  id: string;
  projectId: string;
  name: string;
  cronExp?: string;
  type: JobType;
  content: string;
  status: JobStatus;
  createdAt: number;
}

export interface JobLog {
  id: string;
  jobId: string;
  jobName: string;
  triggerTime: number;
  duration: number;
  status: "success" | "error";
  output: string;
}

export interface StatelessService {
  id: string;
  projectId: string;
  name: string;
  route: string;
  content: string;
  status: 'active' | 'inactive';
  createdAt: number;
}

export interface DataCollection {
  id: string;
  projectId: string;
  name: string;        // e.g. "users", "orders"
  displayName: string; // e.g. "用户数据", "订单数据"
  description: string;
  createdAt: number;
}

export interface DataRecord {
  id: string;
  collectionId: string;
  projectId: string;
  data: Record<string, any>;
  updatedAt: number;
}

