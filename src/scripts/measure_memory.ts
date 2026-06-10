import { createClient } from 'redis';
// @ts-ignore
import { Client as MemcachedClient } from 'memjs';
import { config } from '../config';

function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getRedisMemory(client: any): Promise<number> {
  const info = await client.info('memory');
  const match = info.match(/used_memory:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// Since memjs doesn't natively expose stats parsed easily, we can open a raw socket to Memcached to get stats
import net from 'net';

function getMemcachedBytes(): Promise<number> {
  return new Promise((resolve, reject) => {
    const [host, port] = config.memcachedUrl.split(':');
    const socket = net.connect({ host, port: parseInt(port || '11211', 10) });
    let data = '';

    socket.on('connect', () => {
      socket.write('stats\r\n');
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('END\r\n')) {
        socket.end();
      }
    });

    socket.on('end', () => {
      const match = data.match(/STAT bytes (\d+)/);
      if (match) {
        resolve(parseInt(match[1], 10));
      } else {
        resolve(0);
      }
    });

    socket.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('Connecting to backends to measure memory overhead...');
  
  const redisClient = createClient({ url: config.redisUrl });
  await redisClient.connect();
  const memcachedClient = MemcachedClient.create(config.memcachedUrl);

  // 1. Clear keys
  console.log('Flushing existing data...');
  await redisClient.flushAll();
  await memcachedClient.set('__dummy__', '1'); // Memcached flush is sometimes lazy, we can just delete or overwrite. Or flush_all
  // Send flush_all to Memcached
  await new Promise<void>((resolve) => {
    const [host, port] = config.memcachedUrl.split(':');
    const socket = net.connect({ host, port: parseInt(port || '11211', 10) });
    socket.on('connect', () => {
      socket.write('flush_all\r\n');
      socket.end();
      resolve();
    });
  });

  // Wait a moment for flushes to settle
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 2. Measure baseline memory
  const redisBase = await getRedisMemory(redisClient);
  const memcachedBase = await getMemcachedBytes();

  console.log(`Baseline Memory - Redis: ${(redisBase / 1024 / 1024).toFixed(2)} MB, Memcached: ${(memcachedBase / 1024 / 1024).toFixed(2)} MB`);

  // 3. Generate 100,000 product objects of ~2KB each and write them
  console.log('Generating and writing 100,000 product items...');
  const baseDescription = generateRandomString(600);
  const baseMetadata = {
    specifications: {
      weight: '1.5 kg',
      dimensions: '20cm x 15cm x 10cm',
      manufacturer: 'Global Tech Industries Group LLC',
      origin: 'United States of America',
      warranty_period: '24 Months International Warranty',
      material: 'Premium Grade Polycarbonate and Brushed Aluminum',
      model_number: 'GT-9000-X-PRO',
    },
    attributes: [
      'high-durability', 'eco-friendly-materials', 'low-power-consumption',
      'ip68-waterproof', 'smart-sync-enabled', 'five-star-rated-reviews',
      'easy-maintenance', 'adjustable-speed-settings', 'ergonomic-design'
    ],
    warehouse_details: {
      aisle: 'A12',
      shelf: '4B',
      bin: '99',
      reorder_level: 150,
      supplier_contact: 'support@globaltechindustries.com',
    },
    compliance: {
      fcc: true,
      ce: true,
      rohs: true,
    },
    extra_text: generateRandomString(400)
  };

  const totalKeys = 100000;
  
  // Write to Redis and Memcached
  for (let i = 1; i <= totalKeys; i++) {
    const product = {
      id: i,
      name: `Product Item Deluxe Edition ${i}`,
      description: `${baseDescription} (Item ID: ${i})`,
      price: parseFloat((10.0 + Math.random() * 990.0).toFixed(2)),
      sku: `SKU-PROD-${i.toString().padStart(6, '0')}`,
      views: Math.floor(Math.random() * 100),
      metadata: {
        ...baseMetadata,
        unique_id: `uuid-${i}-${Math.floor(Math.random() * 1000000)}`,
        checksum: `sha256-abc${i}def`
      }
    };
    
    const payload = JSON.stringify(product); // Size is ~2050 bytes
    
    // Write
    await redisClient.set(`product:${i}`, payload);
    await memcachedClient.set(`v1:product:${i}`, payload);

    if (i % 20000 === 0) {
      console.log(`Written ${i}/${totalKeys} items...`);
    }
  }

  // Wait for writes to settle
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 4. Measure final memory
  const redisFinal = await getRedisMemory(redisClient);
  const memcachedFinal = await getMemcachedBytes();

  const redisUsed = redisFinal - redisBase;
  const memcachedUsed = memcachedFinal - memcachedBase;

  const redisOverheadPerKey = redisUsed / totalKeys;
  const memcachedOverheadPerKey = memcachedUsed / totalKeys;

  console.log('\n--- Memory Measurement Results ---');
  console.log(`Redis Total Memory Used: ${(redisUsed / 1024 / 1024).toFixed(2)} MB (${redisUsed} bytes)`);
  console.log(`Redis Overhead per Key: ${redisOverheadPerKey.toFixed(2)} Bytes`);
  console.log(`Memcached Total Memory Used: ${(memcachedUsed / 1024 / 1024).toFixed(2)} MB (${memcachedUsed} bytes)`);
  console.log(`Memcached Overhead per Key: ${memcachedOverheadPerKey.toFixed(2)} Bytes`);

  // Close connections
  await redisClient.quit();
  memcachedClient.close();
}

main().catch(console.error);
