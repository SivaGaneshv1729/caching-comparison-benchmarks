# API Documentation

All endpoints in this project require the `X-Cache-Backend` HTTP header to dictate which caching infrastructure to hit.

**Supported Headers:**
- `X-Cache-Backend: redis`
- `X-Cache-Backend: memcached`

---

## 1. Products API

### `GET /api/products/:id`
Retrieves a specific product by ID.
- **Flow**: Checks Cache -> If Miss -> Queries PostgreSQL -> Caches Response -> Returns to Client.
- **Response**: JSON representation of the product.

### `POST /api/products/:id/view`
Registers a product view and increments the product's position in the global leaderboard.
- **Flow (Redis)**: Uses `ZINCRBY` on a sorted set.
- **Flow (Memcached)**: Acquires a distributed lock using `add`, performs JSON mutation, and writes back.
- **Response**: `200 OK`

### `GET /api/products`
Retrieves paginated products. Protected by a caching-layer rate limiter.
- **Limit**: 100 requests per minute per IP.
- **Response**: `429 Too Many Requests` if the limit is exceeded.

---

## 2. Sessions API

### `POST /api/sessions`
Creates a new temporary user session.
- **Flow (Redis)**: Stored efficiently using Hashes (`HSET`).
- **Flow (Memcached)**: Stored as a serialized JSON string.

### `GET /api/sessions/:id`
Retrieves a session by its unique ID.
