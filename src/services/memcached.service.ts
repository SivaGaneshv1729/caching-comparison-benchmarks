// @ts-ignore
import { Client } from 'memjs';
import { ICacheService } from './cache.interface';
import { config } from '../config';

export class MemcachedService implements ICacheService {
  name = 'memcached';
  private client: Client;

  constructor() {
    this.client = Client.create(config.memcachedUrl);
  }

  async connect(): Promise<void> {
    // memjs establishes connection lazily, but we can verify it by pinging/setting a test key
    await this.client.set('__healthcheck__', '1', { expires: 5 });
  }

  async disconnect(): Promise<void> {
    this.client.close();
  }

  // Helper to fetch global version for cache invalidation pattern
  private async getCacheVersion(): Promise<string> {
    const res = await this.client.get('product_version');
    if (!res || !res.value) {
      // Initialize if not exists
      const success = await this.client.add('product_version', '1');
      if (success) {
        return '1';
      } else {
        const retry = await this.client.get('product_version');
        return retry && retry.value ? retry.value.toString() : '1';
      }
    }
    return res.value.toString();
  }

  // Phase A: Basic Caching with Version Prefix
  async getProduct(id: string): Promise<any | null> {
    const version = await this.getCacheVersion();
    const key = `v${version}:product:${id}`;
    const res = await this.client.get(key);
    if (!res || !res.value) return null;
    return JSON.parse(res.value.toString());
  }

  async setProduct(id: string, product: any, ttl: number): Promise<void> {
    const version = await this.getCacheVersion();
    const key = `v${version}:product:${id}`;
    await this.client.set(key, JSON.stringify(product), { expires: ttl });
  }

  // Invalidation Pattern for Memcached: Global Version Increment
  async invalidateProduct(id: string): Promise<void> {
    // In Memcached, rather than deleting single keys, we increment the global version key.
    // This shifts the prefix for all product keys, effectively invalidating all of them.
    try {
      const res = await this.client.increment('product_version', 1);
      if (!res || !res.value) {
        // If increment failed (e.g. key expired/missing), re-initialize it
        await this.client.set('product_version', '1');
      }
    } catch (err) {
      await this.client.set('product_version', '1');
    }
  }

  // Phase B: Leaderboard
  async incrementProductView(id: string, useLock = true): Promise<number> {
    const leaderboardKey = 'leaderboard_data';
    const lockKey = 'leaderboard_lock';

    if (useLock) {
      let lockAcquired = false;
      let retries = 0;
      const maxRetries = 100;
      let delay = 5; // Start with 5ms backoff

      while (!lockAcquired && retries < maxRetries) {
        // Try to acquire lock using ADD
        lockAcquired = await this.client.add(lockKey, 'locked', { expires: 5 });
        if (!lockAcquired) {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(100, delay * 1.5); // Exponential backoff capped at 100ms
        }
      }

      if (!lockAcquired) {
        throw new Error('Could not acquire leaderboard lock, max retries reached');
      }

      try {
        // Read, modify, set
        const res = await this.client.get(leaderboardKey);
        let list: Array<{ id: string; views: number }> = [];
        if (res && res.value) {
          list = JSON.parse(res.value.toString());
        }

        const item = list.find((x) => x.id === id);
        let newViews = 1;
        if (item) {
          item.views++;
          newViews = item.views;
        } else {
          list.push({ id, views: 1 });
        }

        list.sort((a, b) => b.views - a.views);
        await this.client.set(leaderboardKey, JSON.stringify(list));
        return newViews;
      } finally {
        // Always release lock
        await this.client.delete(lockKey);
      }
    } else {
      // NAIVE IMPLEMENTATION WITHOUT LOCK
      // Exacerbate race conditions using a slight delay to simulate slow concurrent I/O
      const res = await this.client.get(leaderboardKey);
      let list: Array<{ id: string; views: number }> = [];
      if (res && res.value) {
        list = JSON.parse(res.value.toString());
      }

      const item = list.find((x) => x.id === id);
      let newViews = 1;
      if (item) {
        item.views++;
        newViews = item.views;
      } else {
        list.push({ id, views: 1 });
      }

      // Artificially delay execution to guarantee race condition failure
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 8 + 2));

      list.sort((a, b) => b.views - a.views);
      await this.client.set(leaderboardKey, JSON.stringify(list));
      return newViews;
    }
  }

  async getLeaderboard(): Promise<Array<{ id: string; views: number }>> {
    const res = await this.client.get('leaderboard_data');
    if (!res || !res.value) return [];
    const list: Array<{ id: string; views: number }> = JSON.parse(res.value.toString());
    return list.slice(0, 10);
  }

  // Phase C: Rate Limiting
  async checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
    const key = `ratelimit:${userId}`;
    const limit = 100;
    const window = 60;

    const exists = await this.client.get(key);
    let currentCount = 0;

    if (!exists || !exists.value) {
      // Key doesn't exist, try to initialize atomically using ADD
      const success = await this.client.add(key, '1', { expires: window });
      if (success) {
        currentCount = 1;
      } else {
        // Someone else initialized it in the split second, increment it
        const incrRes = await this.client.increment(key, 1);
        currentCount = incrRes && incrRes.value ? incrRes.value : 1;
      }
    } else {
      // Key exists, increment
      const incrRes = await this.client.increment(key, 1);
      currentCount = incrRes && incrRes.value ? incrRes.value : 1;
    }

    const allowed = currentCount <= limit;
    const remaining = Math.max(0, limit - currentCount);

    return { allowed, remaining };
  }

  // Phase D/A: Session Management using Serialized JSON Strings
  async getSession(id: string): Promise<Record<string, string> | null> {
    const res = await this.client.get(`session:${id}`);
    if (!res || !res.value) return null;
    return JSON.parse(res.value.toString());
  }

  async setSessionField(id: string, field: string, value: string): Promise<void> {
    const res = await this.client.get(`session:${id}`);
    let session: Record<string, string> = {};
    if (res && res.value) {
      session = JSON.parse(res.value.toString());
    }
    session[field] = value;
    await this.client.set(`session:${id}`, JSON.stringify(session));
  }

  async createSession(id: string, session: Record<string, string>): Promise<void> {
    await this.client.set(`session:${id}`, JSON.stringify(session));
  }
}
