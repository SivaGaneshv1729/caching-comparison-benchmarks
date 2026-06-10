#!/bin/bash

# Ensure results directory exists
mkdir -p results

# Clear existing results
> results/redis_bench.txt
> results/memcached_bench.txt

echo "Starting Memtier Benchmarks..."
NETWORK_NAME="caching-comparison-benchmarks_default"

# 1. Run Redis Benchmarks
for pipeline in 1 10 50; do
  echo "=========================================="
  echo "Running Redis Benchmark - Pipeline Depth: $pipeline"
  echo "=========================================="
  
  echo "=== PIPELINE DEPTH: $pipeline ===" >> results/redis_bench.txt
  docker run --rm --network $NETWORK_NAME redislabs/memtier_benchmark \
    -s redis \
    -p 6379 \
    -P redis \
    --ratio=9:1 \
    --key-pattern=G:G \
    --pipeline=$pipeline \
    --requests=20000 \
    --clients=20 \
    --threads=2 >> results/redis_bench.txt 2>&1
  
  echo -e "\n\n" >> results/redis_bench.txt
done

# 2. Run Memcached Benchmarks
for pipeline in 1 10 50; do
  echo "=========================================="
  echo "Running Memcached Benchmark - Pipeline Depth: $pipeline"
  echo "=========================================="
  
  echo "=== PIPELINE DEPTH: $pipeline ===" >> results/memcached_bench.txt
  docker run --rm --network $NETWORK_NAME redislabs/memtier_benchmark \
    -s memcached \
    -p 11211 \
    -P memcache_binary \
    --ratio=9:1 \
    --key-pattern=G:G \
    --pipeline=$pipeline \
    --requests=20000 \
    --clients=20 \
    --threads=2 >> results/memcached_bench.txt 2>&1
  
  echo -e "\n\n" >> results/memcached_bench.txt
done

echo "Benchmarks completed. Results saved to results/redis_bench.txt and results/memcached_bench.txt"
