import { createClient, RedisClientType } from 'redis';
import { ICacheService } from './cache.interface';
import { config } from '../config';

export class RedisService implements ICacheService {
  name = 'redis';
  private client: RedisClientType;
  private pubSubClient: RedisClientType; // Dedicated client for Pub/Sub subscription

  constructor() {
    this.client = createClient({ url: config.redisUrl });
    this.pubSubClient = createClient({ url: config.redisUrl });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.pubSubClient.connect();

    // Subscribe to product invalidation channel for verification / logging
    await this.pubSubClient.subscribe('product_invalidation', (message) => {
      console.log(`[Redis Pub/Sub] Received cache invalidation message for product: ${message}`);
    });
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    await this.pubSubClient.quit();
  }

  // Phase A: Basic Caching
  async getProduct(id: string): Promise<any | null> {
    const data = await this.client.get(`product:${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setProduct(id: string, product: any, ttl: number): Promise<void> {
    await this.client.set(`product:${id}`, JSON.stringify(product), {
      EX: ttl
    });
  }

  // Cache Invalidation
  async invalidateProduct(id: string): Promise<void> {
    await this.client.del(`product:${id}`);
    // Publish invalidation event to notify other application instances
    await this.client.publish('product_invalidation', id);
  }

  // Phase B: Leaderboard
  async incrementProductView(id: string, useLock?: boolean): Promise<number> {
    const newViews = await this.client.zIncrBy('leaderboard', 1, id);
    return newViews;
  }

  async getLeaderboard(): Promise<Array<{ id: string; views: number }>> {
    const list = await this.client.zRangeWithScores('leaderboard', 0, 9, {
      REV: true
    });
    return list.map((item) => ({
      id: item.value,
      views: item.score
    }));
  }

  // Phase C: Rate Limiting using atomic Lua script
  async checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
    const key = `ratelimit:${userId}`;
    const limit = 100;
    const window = 60; // seconds

    // Lua script: returns [allowed, current_count]
    const luaScript = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local current = redis.call('get', key)
      if current and tonumber(current) >= limit then
          return {0, limit - tonumber(current)}
      else
          local val = redis.call('incr', key)
          if val == 1 then
              redis.call('expire', key, window)
          end
          return {1, limit - val}
      end
    `;

    // Execute script
    const result = await this.client.eval(luaScript, {
      keys: [key],
      arguments: [limit.toString(), window.toString()]
    }) as [number, number];

    const allowed = result[0] === 1;
    const remaining = Math.max(0, result[1]);

    return { allowed, remaining };
  }

  // Phase D/A: Session Management using Redis Hashes (HSET/HGETALL)
  async getSession(id: string): Promise<Record<string, string> | null> {
    const session = await this.client.hGetAll(`session:${id}`);
    if (!session || Object.keys(session).length === 0) {
      return null;
    }
    return session;
  }

  async setSessionField(id: string, field: string, value: string): Promise<void> {
    await this.client.hSet(`session:${id}`, field, value);
  }

  async createSession(id: string, session: Record<string, string>): Promise<void> {
    await this.client.hSet(`session:${id}`, session);
  }
}
