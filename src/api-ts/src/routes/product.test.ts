import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import productRouter from './product';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import { errorHandler } from '../utils/errors';

let app: express.Express;

describe('Product search and filtering API', () => {
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

    app = express();
    app.use(express.json());
    app.use('/products', productRouter);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('searches product names case-insensitively', async () => {
    const response = await request(app).get('/products?q=smartfeeder');

    expect(response.status).toBe(200);
    expect(response.body.map((product: { productId: number }) => product.productId)).toEqual([1]);
  });

  it('searches SKUs case-insensitively', async () => {
    const response = await request(app).get('/products?q=cat-feed-001');

    expect(response.status).toBe(200);
    expect(response.body.map((product: { productId: number }) => product.productId)).toEqual([1]);
  });

  it('filters by inclusive minimum and maximum price', async () => {
    const response = await request(app).get('/products?minPrice=19.99&maxPrice=100');

    expect(response.status).toBe(200);
    expect(response.body.map((product: { productId: number }) => product.productId)).toEqual([1, 2]);
  });

  it('combines search and price filters', async () => {
    const response = await request(app).get('/products?q=cat&maxPrice=20');

    expect(response.status).toBe(200);
    expect(response.body.map((product: { productId: number }) => product.productId)).toEqual([2]);
  });

  it('returns an empty result when no products match', async () => {
    const response = await request(app).get('/products?q=space-tuna');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('rejects invalid price filters', async () => {
    const invalidPrice = await request(app).get('/products?minPrice=free');
    const invalidRange = await request(app).get('/products?minPrice=100&maxPrice=20');

    expect(invalidPrice.status).toBe(400);
    expect(invalidPrice.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidRange.status).toBe(400);
    expect(invalidRange.body.error.code).toBe('VALIDATION_ERROR');
  });
});
