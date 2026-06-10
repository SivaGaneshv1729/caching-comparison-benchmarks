import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.API_PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5420/catalog_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  memcachedUrl: process.env.MEMCACHED_URL || 'localhost:11211'
};
