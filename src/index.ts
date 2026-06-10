import express, { Request, Response, NextFunction } from 'express';
import { dbService } from './services/db.service';
import { RedisService } from './services/redis.service';
import { MemcachedService } from './services/memcached.service';
import { ICacheService } from './services/cache.interface';
import { config } from './config';

const app = express();
app.use(express.json());

const redisService = new RedisService();
const memcachedService = new MemcachedService();

// Helper to get active cache service based on request header
function getCacheService(req: Request): ICacheService {
  const backend = req.headers['x-cache-backend'];
  if (backend === 'memcached') {
    return memcachedService;
  }
  return redisService;
}

// 1. Healthcheck Endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Check DB connection
    await dbService.query('SELECT 1');
    res.status(200).json({ status: 'healthy', db: 'connected' });
  } catch (err: any) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// 2. Rate Limiter Middleware (100 requests per minute per user)
const rateLimiterMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Identify user via X-User-Id header or default to IP
  const userId = (req.headers['x-user-id'] as string) || req.ip || 'anonymous';
  const cache = getCacheService(req);

  try {
    const { allowed, remaining } = await cache.checkRateLimit(userId);
    res.setHeader('X-RateLimit-Limit', '100');
    res.setHeader('X-RateLimit-Remaining', remaining.toString());

    if (!allowed) {
      res.status(429).json({ error: 'Rate limit exceeded. Max 100 requests per minute.' });
      return;
    }
    next();
  } catch (err: any) {
    console.error('Rate limiting error:', err);
    // If rate limiter fails, fail open or closed depending on requirements.
    // For testing and reliability under load, we log and proceed.
    next();
  }
};

app.use(rateLimiterMiddleware);

// 3. GET /products/:id
app.get('/products/:id', async (req: Request, res: Response): Promise<void> => {
  const productId = req.params.id;
  const cache = getCacheService(req);

  try {
    // Check Cache
    const cachedProduct = await cache.getProduct(productId);
    if (cachedProduct) {
      res.setHeader('X-Cache-Hit', 'true');
      res.json(cachedProduct);
      return;
    }

    // Cache Miss - Query DB
    const dbResult = await dbService.query(
      'SELECT id, name, description, price, sku, views, metadata FROM products WHERE id = $1',
      [parseInt(productId, 10)]
    );

    if (dbResult.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const product = dbResult.rows[0];

    // Populate Cache (TTL = 300s)
    await cache.setProduct(productId, product, 300);

    res.setHeader('X-Cache-Hit', 'false');
    res.json(product);
  } catch (err: any) {
    console.error('Error in GET /products/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /products/:id (Update product details and invalidate cache)
app.post('/products/:id', async (req: Request, res: Response): Promise<void> => {
  const productId = parseInt(req.params.id, 10);
  const { name, price, description, metadata } = req.body;
  const cache = getCacheService(req);

  try {
    // 1. Verify existence
    const verify = await dbService.query('SELECT id, metadata FROM products WHERE id = $1', [productId]);
    if (verify.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // 2. Perform DB Update
    // Merges new metadata if provided, otherwise keeps old
    const updatedMetadata = metadata ? { ...verify.rows[0].metadata, ...metadata } : verify.rows[0].metadata;
    const updateResult = await dbService.query(
      `UPDATE products 
       SET name = COALESCE($1, name), 
           price = COALESCE($2, price), 
           description = COALESCE($3, description),
           metadata = $4
       WHERE id = $5 
       RETURNING id, name, description, price, sku, views, metadata`,
      [name, price, description, JSON.stringify(updatedMetadata), productId]
    );

    const updatedProduct = updateResult.rows[0];

    // 3. Cache Invalidation
    await cache.invalidateProduct(productId.toString());

    res.json(updatedProduct);
  } catch (err: any) {
    console.error('Error in POST /products/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /products/:id/view (Increment view count for the leaderboard)
app.post('/products/:id/view', async (req: Request, res: Response): Promise<void> => {
  const productId = req.params.id;
  const cache = getCacheService(req);
  // Optional query parameter to disable lock for Memcached race testing
  const useLock = req.query.lock !== 'false';

  try {
    // Increment view count in cache
    const currentViews = await cache.incrementProductView(productId, useLock);

    // Write-through or eventual DB write for views count
    await dbService.query('UPDATE products SET views = views + 1 WHERE id = $1', [parseInt(productId, 10)]);

    res.json({ id: productId, views: currentViews });
  } catch (err: any) {
    console.error('Error in POST /products/:id/view:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /leaderboard (Get top 10 viewed product IDs)
app.get('/leaderboard', async (req: Request, res: Response) => {
  const cache = getCacheService(req);

  try {
    const list = await cache.getLeaderboard();
    res.json(list);
  } catch (err: any) {
    console.error('Error in GET /leaderboard:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Session Store Endpoints
// Initializing a session
app.post('/session/:id/init', async (req: Request, res: Response) => {
  const sessionId = req.params.id;
  const sessionData = req.body; // Record<string, string>
  const cache = getCacheService(req);

  try {
    await cache.createSession(sessionId, sessionData);
    res.json({ message: 'Session initialized', id: sessionId, data: sessionData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET session details
app.get('/session/:id', async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.params.id;
  const cache = getCacheService(req);

  try {
    const session = await cache.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST update a single session field
app.post('/session/:id', async (req: Request, res: Response) => {
  const sessionId = req.params.id;
  const { field, value } = req.body;
  const cache = getCacheService(req);

  if (!field || value === undefined) {
    res.status(400).json({ error: 'field and value are required' });
    return;
  }

  try {
    await cache.setSessionField(sessionId, field, value);
    const updated = await cache.getSession(sessionId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const server = app.listen(config.port, async () => {
  console.log(`Server is running on port ${config.port}`);
  
  // Establish cache connections
  try {
    await redisService.connect();
    console.log('Connected to Redis.');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }

  try {
    await memcachedService.connect();
    console.log('Connected to Memcached.');
  } catch (err) {
    console.error('Failed to connect to Memcached:', err);
  }
});

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    await redisService.disconnect();
    await memcachedService.disconnect();
    await dbService.close();
    console.log('All backend connections closed');
  });
});
