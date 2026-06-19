# Architectural Design & Patterns

This application acts as a proxy API that dynamically routes caching requests to either **Redis 7** or **Memcached 1.6**.

## 1. Backend Strategy Switching
The proxy checks the incoming request's `X-Cache-Backend` header.

```mermaid
graph TD
    Client(Client Request) --> Proxy[Node.js Proxy API]
    Proxy -- "X-Cache-Backend: redis" --> Redis[(Redis 7)]
    Proxy -- "X-Cache-Backend: memcached" --> Memcached[(Memcached 1.6)]
    Redis -- "Cache Miss" --> DB[(PostgreSQL 15)]
    Memcached -- "Cache Miss" --> DB
```

## 2. Leaderboard Concurrency & Consistency

### Redis Implementation
Redis provides native Sorted Sets (`ZSET`). We use the `ZINCRBY` atomic command to increment views and maintain the leaderboard simultaneously. Sorting is offloaded to the database engine and executed in $O(\log N)$ time.

### Memcached Implementation
Memcached does not support sorting or complex types. The leaderboard is managed as a serialized JSON list. To prevent race conditions during the *Read -> Modify -> Write* sequence, we implemented a distributed locking pattern.

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Node API
    participant M as Memcached
    C->>API: POST /api/products/:id/view
    loop Exponential Backoff Retry
        API->>M: ADD lock:leaderboard (atomic)
        alt Lock Acquired
            API->>M: GET leaderboard
            API->>API: Parse JSON & Increment View
            API->>M: SET leaderboard (JSON)
            API->>M: DELETE lock:leaderboard
        else Lock Exists
            API->>API: Wait (Backoff)
        end
    end
    API-->>C: 200 OK
```

## 3. Rate Limiter (100 req/min)
- **Redis**: Employs an atomic Lua script executing `INCR` and conditional `EXPIRE` in a single network round-trip.
- **Memcached**: Executes `incr`. If the key does not exist, it falls back to a safe atomic `add` initialization.

## 4. Cache Invalidation
- **Redis**: Performs `DEL` and uses standard `PUBLISH` to broadcast the invalidation event.
- **Memcached**: Implements **Cache Versioning** via a global `product_version` key.
