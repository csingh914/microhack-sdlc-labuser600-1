import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cartRouter from './cart';
import { runMigrations } from '../db/migrate';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { errorHandler } from '../utils/errors';

let app: express.Express;

describe('Checkout API', () => {
  beforeEach(async () => {
    process.env.PAYMENT_PROVIDER = 'demo-card-gateway';
    process.env.PAYMENT_API_KEY = 'test-demo-key';
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
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYMENT_API_KEY;
    await closeDatabase();
  });

  it('should convert a cart into an order after a successful payment', async () => {
    await request(app)
      .post('/cart/items')
      .send({ productId: 1, quantity: 2 })
      .set('X-Cart-Id', 'checkout-success');

    const response = await request(app)
      .post('/cart/checkout')
      .send({
        paymentMethod: 'card',
        cardNumber: '4242 4242 4242 4242',
        expiryDate: '12/30',
        cvv: '123',
        nameOnCard: 'Test User',
      })
      .set('X-Cart-Id', 'checkout-success');

    expect(response.status).toBe(201);
    expect(response.body.paymentStatus).toBe('approved');
    expect(response.body.provider).toBe('demo-card-gateway');
    expect(response.body.apiKeyConfigured).toBe(true);
    expect(response.body.order.name).toContain('checkout-success');
    expect(response.body.orderDetails).toHaveLength(1);
    expect(response.body.orderDetails[0].quantity).toBe(2);
  });

  it('should reject a declined payment and keep the cart intact', async () => {
    await request(app)
      .post('/cart/items')
      .send({ productId: 1, quantity: 1 })
      .set('X-Cart-Id', 'checkout-fail');

    const response = await request(app)
      .post('/cart/checkout')
      .send({
        paymentMethod: 'card',
        cardNumber: '4000 0000 0000 0002',
        expiryDate: '12/30',
        cvv: '123',
        nameOnCard: 'Test User',
      })
      .set('X-Cart-Id', 'checkout-fail');

    expect(response.status).toBe(402);
    expect(response.body.error.message).toMatch(/declined|payment/i);

    const cartResponse = await request(app).get('/cart').set('X-Cart-Id', 'checkout-fail');
    expect(cartResponse.body.itemCount).toBe(1);
  });
});
