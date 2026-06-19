# Benchmark & Performance Findings

This project systematically compared Redis 7 and Memcached 1.6 across throughput, memory usage, and concurrency handling.

## 1. Memory Comparison

Below is the reported memory usage and overhead for storing **100,000 product objects** (averaging ~2KB each):

| Storage Backend | Reported Used Memory (MB) | Overhead per Key (Bytes) |
| :--- | :---: | :---: |
| **Redis 7** | 201.68 MB | 2114.73 Bytes |
| **Memcached 1.6** | 51.54 MB | 540.39 Bytes |

> **Key Insight:** Memcached exhibits almost **4x lower** memory overhead per key compared to Redis. This is due to Memcached's lean, multi-threaded slab allocation design which stores raw values, whereas Redis wraps values in `robj` structures, uses hash tables with `dictEntry` overhead, SDS (Simple Dynamic Strings), and maintains complex internal type descriptors.

## 2. Raw Cache Performance (Throughput & Latency)

Benchmarks were generated using `memtier_benchmark` with a Pipeline Depth of 1:

- **Redis**: ~76,480 Ops/sec | p99 Latency: ~0.415 ms
- **Memcached**: ~53,727 Ops/sec | p99 Latency: ~0.687 ms

## 3. Concurrency Stress Test (Race Test)

To test the locking requirements of Memcached compared to Redis, we built `race_test.ts`. This spawns **10 concurrent clients** making **100 requests each** (1000 total) to increment a product's views simultaneously:

- **Redis (ZINCRBY)**: **0** lost increments (exactly 1000 views recorded) due to atomic event-loop execution.
- **Memcached (With Lock)**: **0** lost increments (exactly 1000 views recorded) due to the distributed locking wrapper.
- **Memcached (No Lock - Naive)**: **1000** lost increments (0 views recorded or heavily corrupted) due to overlapping read-modify-write transactions overwriting each other.
