import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cartRouter from './cart';
import { runMigrations } from '../db/migrate';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { errorHandler } from '../utils/errors';

let app: express.Express;

describe('Cart API', () => {
  beforeEach(async () => {
    await closeDatabase();
    await getDatabase(true);
    await runMigrations(true);

    const db = await getDatabase();
    await db.run('INSERT INTO suppliers (supplier_id, name, description, email, phone, active, verified) VALUES (?, ?, ?, ?, ?, ?, ?)', [1, 'Supplier One', 'Primary supplier', 'supplier@example.com', '555-1111', 1, 1]);
    await db.run('INSERT INTO headquarters (headquarters_id, name) VALUES (?, ?)', [1, 'HQ One']);
    await db.run('INSERT INTO branches (branch_id, headquarters_id, name) VALUES (?, ?, ?)', [1, 1, 'Main Branch']);
    await db.run(
      `INSERT INTO products (product_id, supplier_id, name, description, price, sku, unit, img_name, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [1, 1, 'Cat toy', 'A playful toy', 19.99, 'TOY-100', 'piece', 'toy.png', 0],
    );

    app = express();
    app.use(express.json());
    app.use('/cart', cartRouter);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('should create a cart and add an item', async () => {
    const response = await request(app)
      .post('/cart/items')
      .send({ productId: 1, quantity: 2 })
      .set('X-Cart-Id', 'cart-123');

    expect(response.status).toBe(200);
    expect(response.body.itemCount).toBe(2);
    expect(response.body.total).toBe(39.98);
    expect(response.body.items[0]).toMatchObject({ productId: 1, quantity: 2 });
  });

  it('should update cart item quantity', async () => {
    await request(app)
      .post('/cart/items')
      .send({ productId: 1, quantity: 1 })
      .set('X-Cart-Id', 'cart-456');

    const response = await request(app)
      .put('/cart/items/1')
      .send({ quantity: 3 })
      .set('X-Cart-Id', 'cart-456');

    expect(response.status).toBe(200);
    expect(response.body.items[0].quantity).toBe(3);
    expect(response.body.total).toBe(59.97);
  });

  it('should remove an item from the cart', async () => {
    await request(app)
      .post('/cart/items')
      .send({ productId: 1, quantity: 2 })
      .set('X-Cart-Id', 'cart-789');

    const response = await request(app)
      .delete('/cart/items/1')
      .set('X-Cart-Id', 'cart-789');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.total).toBe(0);
  });
});
