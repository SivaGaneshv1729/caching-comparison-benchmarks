import { Pool } from 'pg';
import { config } from '../config';

class DbService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async query(text: string, params?: any[]) {
    return this.pool.query(text, params);
  }

  async close() {
    await this.pool.end();
  }
}

export const dbService = new DbService();
