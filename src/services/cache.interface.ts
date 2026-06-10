export interface ICacheService {
  name: string;

  // Connection Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Basic Caching & Invalidation
  getProduct(id: string): Promise<any | null>;
  setProduct(id: string, product: any, ttl: number): Promise<void>;
  invalidateProduct(id: string): Promise<void>;

  // Leaderboard
  incrementProductView(id: string, useLock?: boolean): Promise<number>;
  getLeaderboard(): Promise<Array<{ id: string; views: number }>>;

  // Rate Limiting (100 req/min)
  checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }>;

  // Session Management
  getSession(id: string): Promise<Record<string, string> | null>;
  setSessionField(id: string, field: string, value: string): Promise<void>;
  createSession(id: string, session: Record<string, string>): Promise<void>;
}
