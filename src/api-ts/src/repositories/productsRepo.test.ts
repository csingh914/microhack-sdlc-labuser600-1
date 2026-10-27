import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import { ProductsRepository } from './productsRepo';

describe('ProductsRepository.findAll filters', () => {
  let repository: ProductsRepository;

  beforeEach(async () => {
    await closeDatabase();
    await getDatabase(true);
    await runMigrations(true);

    const db = await getDatabase();
    await db.run(
      'INSERT INTO suppliers (supplier_id, name, description, email, phone, active, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [1, 'Supplier One', 'Primary supplier', 'supplier@example.com', '555-1111', 1, 1],
    );
    await db.run(
      'INSERT INTO products (product_id, supplier_id, name, description, price, sku, unit, img_name, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [1, 1, 'SmartFeeder One', 'Automated feeder', 129.99, 'CAT-FEED-001', 'piece', 'feeder.png', 0.25],
    );
    await db.run(
      'INSERT INTO products (product_id, supplier_id, name, description, price, sku, unit, img_name, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [2, 1, 'Cat Toy', 'Interactive toy', 19.99, 'TOY-100', 'piece', 'toy.png', 0],
    );
    await db.run(
      'INSERT INTO products (product_id, supplier_id, name, description, price, sku, unit, img_name, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [3, 1, 'Premium Cat Bed', 'Comfort bed', 110, 'BED-200', 'piece', 'bed.png', 0],
    );

    repository = new ProductsRepository(db);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('returns all products when filters are omitted', async () => {
    const products = await repository.findAll();

    expect(products.map((product) => product.productId)).toEqual([1, 2, 3]);
  });

  it('searches names and SKUs case-insensitively', async () => {
    const byName = await repository.findAll({ query: 'smartfeeder' });
    const bySku = await repository.findAll({ query: 'cat-feed-001' });

    expect(byName.map((product) => product.productId)).toEqual([1]);
    expect(bySku.map((product) => product.productId)).toEqual([1]);
  });

  it('searches descriptions and treats LIKE wildcards as literal text', async () => {
    const byDescription = await repository.findAll({ query: 'AUTOMATED FEEDER' });
    const byLiteralWildcard = await repository.findAll({ query: '%' });

    expect(byDescription.map((product) => product.productId)).toEqual([1]);
    expect(byLiteralWildcard).toEqual([]);
  });

  it('filters by inclusive discounted price bounds', async () => {
    const products = await repository.findAll({ minPrice: 19.99, maxPrice: 97.4925 });

    expect(products.map((product) => product.productId)).toEqual([1, 2]);
  });

  it('combines search and price filters', async () => {
    const products = await repository.findAll({ query: 'cat', maxPrice: 20 });

    expect(products.map((product) => product.productId)).toEqual([2]);
  });
});
