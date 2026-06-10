declare module 'memjs' {
  export interface ClientOptions {
    expires?: number;
    initial?: number;
  }

  export class Client {
    static create(servers?: string, options?: any): Client;
    get(key: string): Promise<{ value: Buffer | null; flags: Buffer | null }>;
    set(key: string, value: string | Buffer, options?: ClientOptions): Promise<boolean>;
    add(key: string, value: string | Buffer, options?: ClientOptions): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    increment(key: string, amount: number, options?: ClientOptions): Promise<{ value: number; success: boolean }>;
    close(): void;
  }
}
