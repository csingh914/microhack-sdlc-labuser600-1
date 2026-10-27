import express from 'express';
import { CartSummary, CartItem } from '../models/cart';
import { getProductsRepository } from '../repositories/productsRepo';
import { getOrdersRepository } from '../repositories/ordersRepo';
import { getOrderDetailsRepository } from '../repositories/orderDetailsRepo';
import { getDatabase } from '../db/sqlite';

const router = express.Router();
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? 'demo-card-gateway';
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY ?? 'demo-test-key';

const carts = new Map<string, Map<number, CartItem>>();

function getCart(cartId: string): Map<number, CartItem> {
  if (!carts.has(cartId)) {
    carts.set(cartId, new Map());
  }

  return carts.get(cartId)!;
}

function getCartId(req: express.Request): string {
  return req.header('X-Cart-Id') || 'default-cart';
}

function calculateEffectivePrice(price: number, discount: number): number {
  return Number((price * (1 - (discount ?? 0))).toFixed(2));
}

function calculateItemSubtotal(item: CartItem): number {
  return Number((item.unitPrice * item.quantity).toFixed(2));
}

function buildSummary(cartId: string): CartSummary {
  const items = Array.from(getCart(cartId).values()).map((item) => ({
    ...item,
    subtotal: calculateItemSubtotal(item),
  }));

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));

  return {
    cartId,
    items,
    itemCount,
    total,
  };
}

router.get('/', (req, res) => {
  const cartId = getCartId(req);
  res.json(buildSummary(cartId));
});

router.post('/items', async (req, res, next) => {
  try {
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.quantity);

    if (!Number.isInteger(productId) || productId <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productId must be a positive integer' } });
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive integer' } });
      return;
    }

    const repo = await getProductsRepository();
    const product = await repo.findById(productId);

    if (!product) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
      return;
    }

    const cartId = getCartId(req);
    const cart = getCart(cartId);
    const existing = cart.get(productId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    const unitPrice = calculateEffectivePrice(product.price, product.discount ?? 0);

    const item: CartItem = {
      productId: product.productId,
      name: product.name,
      price: product.price,
      discount: product.discount ?? 0,
      unitPrice,
      quantity: nextQuantity,
      subtotal: Number((unitPrice * nextQuantity).toFixed(2)),
    };

    cart.set(productId, item);
    res.json(buildSummary(cartId));
  } catch (error) {
    next(error);
  }
});

router.put('/items/:productId', async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const quantity = Number(req.body.quantity);

    if (!Number.isInteger(productId) || productId <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productId must be a positive integer' } });
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'quantity must be zero or greater' } });
      return;
    }

    const cartId = getCartId(req);
    const cart = getCart(cartId);
    const item = cart.get(productId);

    if (!item) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Cart item not found' } });
      return;
    }

    if (quantity === 0) {
      cart.delete(productId);
      res.json(buildSummary(cartId));
      return;
    }

    const newItem: CartItem = {
      ...item,
      quantity,
      subtotal: Number((item.unitPrice * quantity).toFixed(2)),
    };

    cart.set(productId, newItem);
    res.json(buildSummary(cartId));
  } catch (error) {
    next(error);
  }
});

router.delete('/items/:productId', (req, res) => {
  const cartId = getCartId(req);
  const productId = Number(req.params.productId);
  const cart = getCart(cartId);

  if (cart.delete(productId)) {
    res.json(buildSummary(cartId));
    return;
  }

  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Cart item not found' } });
});

router.post('/checkout', async (req, res, next) => {
  try {
    const cartId = getCartId(req);
    const cart = getCart(cartId);
    const cartItems = Array.from(cart.values());

    if (cartItems.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Cart is empty' } });
      return;
    }

    const { paymentMethod, cardNumber, expiryDate, cvv, nameOnCard } = req.body ?? {};
    const normalizedCard = String(cardNumber ?? '').replace(/\s+/g, '');

    if (paymentMethod !== 'card') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Unsupported payment method' } });
      return;
    }

    if (!normalizedCard || normalizedCard.length < 12 || !expiryDate || !cvv || !nameOnCard) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Payment details are incomplete' } });
      return;
    }

    const isApproved = normalizedCard !== '4000000000000002';
    if (!isApproved) {
      res.status(402).json({
        error: {
          code: 'PAYMENT_DECLINED',
          message: 'Payment was declined by the issuing bank. Please use another card or payment method.',
        },
        provider: PAYMENT_PROVIDER,
        apiKeyConfigured: Boolean(PAYMENT_API_KEY),
      });
      return;
    }

    const db = await getDatabase();
    const branchRow = await db.get<{ branch_id: number }>('SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1');
    const branchId = branchRow?.branch_id ?? 1;

    const ordersRepo = await getOrdersRepository();
    const orderDetailsRepo = await getOrderDetailsRepository();
    const order = await ordersRepo.create({
      branchId,
      orderDate: new Date().toISOString(),
      name: `Cart checkout ${cartId}`,
      description: `Order created from ${cartId}`,
      status: 'pending',
    });

    const orderDetails = await Promise.all(
      cartItems.map(async (item) =>
        orderDetailsRepo.create({
          orderId: order.orderId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          notes: `Checkout item for ${cartId}`,
        }),
      ),
    );

    carts.delete(cartId);

    res.status(201).json({
      paymentStatus: 'approved',
      provider: PAYMENT_PROVIDER,
      apiKeyConfigured: Boolean(PAYMENT_API_KEY),
      order,
      orderDetails,
      total: buildSummary(cartId).total,
      itemCount: buildSummary(cartId).itemCount,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
