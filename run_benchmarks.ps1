New-Item -ItemType Directory -Force -Path .\results | Out-Null

# Clear or create result files in UTF-8
$null | Out-File -FilePath .\results\redis_bench.txt -Encoding utf8
$null | Out-File -FilePath .\results\memcached_bench.txt -Encoding utf8

Write-Host "Starting Memtier Benchmarks via Docker..."
$networkName = "caching-comparison-benchmarks_default"

# 1. Run Redis Benchmarks
foreach ($pipeline in 1, 10, 50) {
    Write-Host "=========================================="
    Write-Host "Running Redis Benchmark - Pipeline Depth: $pipeline"
    Write-Host "=========================================="
    
    Add-Content -Path .\results\redis_bench.txt -Value "=== PIPELINE DEPTH: $pipeline ===" -Encoding utf8
    
    # Run container and append output as UTF-8
    docker run --rm --network $networkName redislabs/memtier_benchmark `
      -s redis `
      -p 6379 `
      -P redis `
      --ratio=9:1 `
      --key-pattern=G:G `
      --pipeline=$pipeline `
      --requests=20000 `
      --clients=20 `
      --threads=2 | Out-String | Add-Content -Path .\results\redis_bench.txt -Encoding utf8
      
    Add-Content -Path .\results\redis_bench.txt -Value "`r`n`r`n" -Encoding utf8
}

# 2. Run Memcached Benchmarks
foreach ($pipeline in 1, 10, 50) {
    Write-Host "=========================================="
    Write-Host "Running Memcached Benchmark - Pipeline Depth: $pipeline"
    Write-Host "=========================================="
    
    Add-Content -Path .\results\memcached_bench.txt -Value "=== PIPELINE DEPTH: $pipeline ===" -Encoding utf8
    
    docker run --rm --network $networkName redislabs/memtier_benchmark `
      -s memcached `
      -p 11211 `
      -P memcache_binary `
      --ratio=9:1 `
      --key-pattern=G:G `
      --pipeline=$pipeline `
      --requests=20000 `
      --clients=20 `
      --threads=2 | Out-String | Add-Content -Path .\results\memcached_bench.txt -Encoding utf8
      
    Add-Content -Path .\results\memcached_bench.txt -Value "`r`n`r`n" -Encoding utf8
}

Write-Host "Benchmarks completed. Results saved in UTF-8."
