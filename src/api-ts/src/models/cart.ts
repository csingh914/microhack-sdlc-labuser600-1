export interface CartItem {
  productId: number;
  name: string;
  price: number;
  discount: number;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface CartSummary {
  cartId: string;
  items: CartItem[];
  itemCount: number;
  total: number;
}
