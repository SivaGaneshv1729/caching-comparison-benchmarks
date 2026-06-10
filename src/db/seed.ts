import { dbService } from '../services/db.service';

function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function seed() {
  console.log('Starting database seeding...');
  const start = Date.now();

  try {
    // Drop existing table if any and recreate it
    await dbService.query('DROP TABLE IF EXISTS products;');
    await dbService.query(`
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        sku VARCHAR(100) NOT NULL UNIQUE,
        views INTEGER DEFAULT 0,
        metadata JSONB NOT NULL
      );
    `);
    console.log('Created products table.');

    // Seed in batches of 2000 to keep memory low and run quickly
    const totalRows = 100000;
    const batchSize = 2000;
    const totalBatches = totalRows / batchSize;

    // We want the average product representation to be ~2KB.
    // metadata is ~1.2KB, description is ~600B.
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
      extra_text: generateRandomString(400) // extra padding to reach 2KB total structure size
    };

    for (let batch = 0; batch < totalBatches; batch++) {
      const values: any[] = [];
      const placeholders: string[] = [];

      for (let i = 0; i < batchSize; i++) {
        const index = batch * batchSize + i + 1;
        const name = `Product Item Deluxe Edition ${index}`;
        const description = `${baseDescription} (Item ID: ${index})`;
        const price = parseFloat((10.0 + Math.random() * 990.0).toFixed(2));
        const sku = `SKU-PROD-${index.toString().padStart(6, '0')}`;
        // Randomize initial views slightly to have some pre-existing leaderboard variance
        const views = Math.floor(Math.random() * 100); 

        const metadata = {
          ...baseMetadata,
          unique_id: `uuid-${index}-${Math.floor(Math.random() * 1000000)}`,
          checksum: `sha256-abc${index}def`
        };

        const offset = i * 6;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
        values.push(name, description, price, sku, views, JSON.stringify(metadata));
      }

      const queryText = `
        INSERT INTO products (name, description, price, sku, views, metadata)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (sku) DO NOTHING;
      `;
      await dbService.query(queryText, values);

      if ((batch + 1) % 10 === 0 || batch + 1 === totalBatches) {
        console.log(`Seeded ${batch * batchSize + batchSize}/${totalRows} products...`);
      }
    }

    console.log(`Successfully seeded 100,000 products in ${((Date.now() - start) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await dbService.close();
  }
}

// Check if running directly to execute
if (require.main === module) {
  seed();
}
export { seed };
