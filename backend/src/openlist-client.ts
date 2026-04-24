/**
 * Thin REST client for OpenList (fork of Alist).
 *
 * Docs: https://doc.oplist.org / https://alistgo.com/guide/api/
 *
 * Only the subset we actually use:
 *  - POST /api/fs/list        list a directory
 *  - POST /api/fs/copy        enqueue a copy task (baidu -> local)
 *  - GET  /api/task/copy/undone   list pending/running tasks
 *  - GET  /api/task/copy/done     list finished tasks (auto-cleared by OpenList, poll fast)
 *  - POST /api/task/copy/cancel   cancel a task
 */

export type OpenListConfig = {
  baseUrl: string;
  token: string;
};

export type FsListItem = {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  sign?: string;
  thumb?: string;
  type: number;
};

export type OpenListTask = {
  id: string;
  name: string;
  state: number; // 0 pending, 1 running, 2 success, 3 cancelled, 4 errored, etc.
  status: string; // human readable
  progress: number; // 0-100
  error: string;
  start_time?: string;
  end_time?: string;
};

type RawResponse<T> = {
  code: number;
  message: string;
  data: T;
};

export class OpenListClient {
  constructor(private cfg: OpenListConfig) {}

  setToken(token: string) {
    this.cfg.token = token;
  }

  async list(path: string, password = ""): Promise<FsListItem[]> {
    const res = await this.post<{ content: FsListItem[] | null }>(
      "/api/fs/list",
      {
        path,
        password,
        page: 1,
        per_page: 0,
        refresh: false,
      },
    );
    return res.content ?? [];
  }

  /**
   * Enqueue a copy task. OpenList returns the task id(s) via the task API;
   * for a single-file copy we resolve the task by polling the undone list.
   */
  async copy(opts: {
    src_dir: string;
    dst_dir: string;
    names: string[];
  }): Promise<void> {
    await this.post("/api/fs/copy", opts);
  }

  /** List undone copy tasks (pending + running). */
  async undoneCopyTasks(): Promise<OpenListTask[]> {
    return this.get<OpenListTask[]>("/api/task/copy/undone");
  }

  /** List done copy tasks (success + cancelled + errored). */
  async doneCopyTasks(): Promise<OpenListTask[]> {
    return this.get<OpenListTask[]>("/api/task/copy/done");
  }

  async cancelCopyTask(taskId: string): Promise<void> {
    await this.post(`/api/task/copy/cancel?tid=${encodeURIComponent(taskId)}`);
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/ping`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.unwrap<T>(res);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      headers: this.headers(),
    });
    return this.unwrap<T>(res);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.token) h["Authorization"] = this.cfg.token;
    return h;
  }

  private async unwrap<T>(res: Response): Promise<T> {
    if (!res.ok) {
      throw new Error(`openlist ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as RawResponse<T>;
    if (json.code !== 200) {
      throw new Error(`openlist code=${json.code} message=${json.message}`);
    }
    return json.data;
  }
}
