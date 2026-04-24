declare module "node-mpv" {
  export default class MPV {
    constructor(options?: Record<string, unknown>, mpvArgs?: string[]);
    start(): Promise<void>;
    load(path: string, mode?: string): Promise<void>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    setProperty(prop: string, val: unknown): Promise<void>;
    getProperty(prop: string): Promise<unknown>;
    command(cmd: string, args: unknown[]): Promise<void>;
    addListener(event: string, cb: (...a: unknown[]) => void): void;
    on(event: string, cb: (...a: unknown[]) => void): void;
    quit(): Promise<void>;
  }
}
