import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useQuery } from 'react-query';
import { api } from '../../../api/config';
import { useTheme } from '../../../context/ThemeContext';

interface Product {
  productId: number;
  name: string;
  description: string;
  price: number;
  imgName: string;
  sku: string;
  unit: string;
  supplierId: number;
  discount?: number;
}

interface ProductFilters {
  query: string;
  minPrice: string;
  maxPrice: string;
}

const fetchProducts = async ({ query, minPrice, maxPrice }: ProductFilters): Promise<Product[]> => {
  const params: Record<string, string> = {};
  if (query.trim()) {
    params.q = query.trim();
  }
  if (minPrice) {
    params.minPrice = minPrice;
  }
  if (maxPrice) {
    params.maxPrice = maxPrice;
  }

  const { data } = await axios.get(`${api.baseURL}${api.endpoints.products}`, { params });
  return data;
};

interface CartItem {
  productId: number;
  name: string;
  price: number;
  discount: number;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

interface CartSummary {
  cartId: string;
  items: CartItem[];
  itemCount: number;
  total: number;
}

const getCartId = () => {
  const storedCartId = localStorage.getItem('octocat-cart-id');
  if (storedCartId) {
    return storedCartId;
  }

  const newCartId = `cart-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem('octocat-cart-id', newCartId);
  return newCartId;
};

const fetchCart = async (): Promise<CartSummary> => {
  const cartId = getCartId();
  const { data } = await axios.get(`${api.baseURL}${api.endpoints.cart}`, {
    headers: { 'X-Cart-Id': cartId },
  });
  return data;
};

export default function Products() {
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    cardNumber: '',
    expiryDate: '',
    cvv: '',
    nameOnCard: '',
  });
  const [cartId, setCartId] = useState<string>('');
  const isValidPrice = (value: string) =>
    value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0);
  const hasInvalidPriceRange =
    !isValidPrice(minPrice) ||
    !isValidPrice(maxPrice) ||
    (minPrice !== '' && maxPrice !== '' && Number(minPrice) > Number(maxPrice));
  const { data: products, isLoading, error } = useQuery(
    ['products', searchTerm, minPrice, maxPrice],
    () => fetchProducts({ query: searchTerm, minPrice, maxPrice }),
    { enabled: !hasInvalidPriceRange, keepPreviousData: true },
  );
  const { data: cart, refetch: refetchCart } = useQuery('cart', fetchCart, {
    enabled: false,
  });
  const { darkMode } = useTheme();

  useEffect(() => {
    const initialCartId = getCartId();
    setCartId(initialCartId);
    refetchCart();
  }, [refetchCart]);

  const filteredProducts = products;

  const cartTotal = useMemo(() => cart?.total ?? 0, [cart]);
  const cartItemCount = useMemo(() => cart?.itemCount ?? 0, [cart]);

  const handleCheckout = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cart?.items.length) {
      return;
    }

    try {
      const response = await axios.post(
        `${api.baseURL}${api.endpoints.cart}/checkout`,
        {
          paymentMethod: 'card',
          ...paymentForm,
        },
        { headers: { 'X-Cart-Id': cartId || getCartId() } },
      );

      setCheckoutOpen(false);
      setCheckoutError(null);
      setPaymentForm({ cardNumber: '', expiryDate: '', cvv: '', nameOnCard: '' });
      await refetchCart();
      alert(`Payment approved. Order ${response.data.order.orderId} created.`);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.error?.message) {
        setCheckoutError(error.response.data.error.message);
        return;
      }

      setCheckoutError('Unable to complete checkout. Please try again.');
    }
  };

  const handleQuantityChange = (productId: number, change: number) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + change),
    }));
  };

  const handleAddToCart = async (product: Product) => {
    const quantity = quantities[product.productId] || 0;
    if (quantity <= 0) {
      return;
    }

    await axios.post(
      `${api.baseURL}${api.endpoints.cart}/items`,
      {
        productId: product.productId,
        quantity,
        name: product.name,
        price: product.price,
        discount: product.discount ?? 0,
      },
      { headers: { 'X-Cart-Id': cartId || getCartId() } },
    );

    setQuantities((prev) => ({
      ...prev,
      [product.productId]: 0,
    }));
    await refetchCart();
  };

  const handleCartItemChange = async (productId: number, quantity: number) => {
    if (quantity <= 0) {
      await axios.delete(`${api.baseURL}${api.endpoints.cart}/items/${productId}`, {
        headers: { 'X-Cart-Id': cartId || getCartId() },
      });
    } else {
      await axios.put(
        `${api.baseURL}${api.endpoints.cart}/items/${productId}`,
        { quantity },
        { headers: { 'X-Cart-Id': cartId || getCartId() } },
      );
    }

    await refetchCart();
  };

  const handleProductClick = (product: Product) => {
    setSelectedProduct(product);
    setShowModal(true);
  };

  if (isLoading && !products) {
    return (
      <div
        className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-20 px-4 transition-colors duration-300`}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-primary"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-20 px-4 transition-colors duration-300`}
      >
        <div className="max-w-7xl mx-auto">
          <div className="text-red-500 text-center">Failed to fetch products</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-20 pb-16 px-4 transition-colors duration-300`}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col space-y-6">
          <h1
            className={`text-3xl font-bold ${darkMode ? 'text-light' : 'text-gray-800'} transition-colors duration-300`}
          >
            Products
          </h1>

          <div className="relative">
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full px-4 py-2 ${darkMode ? 'bg-gray-800 text-light border-gray-700' : 'bg-white text-gray-800 border-gray-300'} rounded-lg border focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors duration-300`}
              aria-label="Search products"
            />
            <svg
              className={`absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'} transition-colors duration-300`}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="min-price"
                className={`mb-1 block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                Minimum price
              </label>
              <input
                id="min-price"
                type="number"
                min="0"
                step="0.01"
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                className={`w-36 rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-700 bg-gray-800 text-light' : 'border-gray-300 bg-white text-gray-800'}`}
              />
            </div>
            <div>
              <label
                htmlFor="max-price"
                className={`mb-1 block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                Maximum price
              </label>
              <input
                id="max-price"
                type="number"
                min="0"
                step="0.01"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                className={`w-36 rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-700 bg-gray-800 text-light' : 'border-gray-300 bg-white text-gray-800'}`}
              />
            </div>
            {(searchTerm || minPrice || maxPrice) && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setMinPrice('');
                  setMaxPrice('');
                }}
                className={`rounded-lg px-3 py-2 text-sm ${darkMode ? 'bg-gray-700 text-light hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              >
                Clear filters
              </button>
            )}
          </div>
          {hasInvalidPriceRange && (
            <p className="text-sm text-red-500" role="alert">
              Enter non-negative prices, with the minimum no greater than the maximum.
            </p>
          )}

          <div
            className={`rounded-xl border p-4 ${darkMode ? 'bg-gray-800 border-gray-700 text-light' : 'bg-white border-gray-200 text-gray-800'} shadow-sm`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className={`text-sm uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Cart summary
                </p>
                <p className="text-2xl font-bold text-primary">${cartTotal.toFixed(2)}</p>
              </div>
              <div className={`text-right ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                <p className="text-sm">Items</p>
                <p className="text-lg font-semibold">{cartItemCount}</p>
              </div>
            </div>

            {cart?.items.length ? (
              <div className="mt-4 space-y-2">
                {cart.items.map((item) => (
                  <div
                    key={item.productId}
                    className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        ${item.unitPrice.toFixed(2)} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCartItemChange(item.productId, item.quantity - 1)}
                        className={`h-7 w-7 rounded ${darkMode ? 'bg-gray-600 text-light' : 'bg-gray-200 text-gray-700'}`}
                        aria-label={`Decrease ${item.name} quantity in cart`}
                      >
                        −
                      </button>
                      <span className="min-w-[1.5rem] text-center">{item.quantity}</span>
                      <button
                        onClick={() => handleCartItemChange(item.productId, item.quantity + 1)}
                        className={`h-7 w-7 rounded ${darkMode ? 'bg-gray-600 text-light' : 'bg-gray-200 text-gray-700'}`}
                        aria-label={`Increase ${item.name} quantity in cart`}
                      >
                        +
                      </button>
                      <button
                        onClick={() => handleCartItemChange(item.productId, 0)}
                        className="ml-2 text-sm text-red-500 hover:text-red-400"
                        aria-label={`Remove ${item.name} from cart`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setCheckoutOpen(true)}
                  className="mt-3 w-full rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-accent"
                >
                  Checkout
                </button>
              </div>
            ) : (
              <p className={`mt-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Your cart is empty.
              </p>
            )}
          </div>

          {checkoutOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className={`${darkMode ? 'bg-gray-800 text-light' : 'bg-white text-gray-800'} w-full max-w-md rounded-xl p-6 shadow-xl`}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold">Checkout</h2>
                  <button onClick={() => setCheckoutOpen(false)} className="text-xl leading-none">
                    ×
                  </button>
                </div>

                <form onSubmit={handleCheckout} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Cardholder name</label>
                    <input
                      type="text"
                      value={paymentForm.nameOnCard}
                      onChange={(event) => setPaymentForm((prev) => ({ ...prev, nameOnCard: event.target.value }))}
                      className={`w-full rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Card number</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={paymentForm.cardNumber}
                      onChange={(event) => setPaymentForm((prev) => ({ ...prev, cardNumber: event.target.value }))}
                      className={`w-full rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}
                      placeholder="4242 4242 4242 4242"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Expiry</label>
                      <input
                        type="text"
                        value={paymentForm.expiryDate}
                        onChange={(event) => setPaymentForm((prev) => ({ ...prev, expiryDate: event.target.value }))}
                        className={`w-full rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}
                        placeholder="12/30"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">CVV</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={paymentForm.cvv}
                        onChange={(event) => setPaymentForm((prev) => ({ ...prev, cvv: event.target.value }))}
                        className={`w-full rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}
                        placeholder="123"
                        required
                      />
                    </div>
                  </div>

                  {checkoutError && (
                    <p className="rounded-lg border border-red-500 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                      {checkoutError}
                    </p>
                  )}

                  <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-accent">
                    Pay ${cartTotal.toFixed(2)}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Empty state when no products match */}
          {!hasInvalidPriceRange && (!filteredProducts || filteredProducts.length === 0) && (
            <div
              className={`flex flex-col items-center justify-center text-center py-20 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-white'
                } shadow-sm border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}
              role="status"
              aria-live="polite"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-12 w-12 mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h7l2 3h9v13a2 2 0 01-2 2H5a2 2 0 01-2-2V3zm3 7h12" />
              </svg>
              <p className={`${darkMode ? 'text-light' : 'text-gray-800'} text-lg font-medium`}>
                No products found
              </p>
              {searchTerm && (
                <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} mt-2`}>
                  Try clearing or changing your search filters.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts?.map((product) => {
              const hasDiscount = product.discount != null && product.discount > 0;
              return (
                <div
                  key={product.productId}
                  className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg overflow-hidden shadow-lg transform transition-all duration-300 hover:scale-105 hover:shadow-[0_0_25px_rgba(118,184,82,0.3)] flex flex-col`}
                >
                  <div
                    className={`relative h-56 ${darkMode ? 'bg-gradient-to-t from-gray-700 to-gray-800' : 'bg-gradient-to-t from-gray-100 to-white'} transition-colors duration-300 cursor-pointer`}
                    onClick={() => handleProductClick(product)}
                  >
                    <img
                      src={`/${product.imgName}`}
                      alt={product.name}
                      className="w-full h-full object-contain p-2"
                    />
                    {hasDiscount && (
                      <div className="absolute top-8 left-0 bg-primary text-white px-3 py-1 -rotate-90 transform -translate-x-5 shadow-md">
                        {Math.round(product.discount! * 100)}% OFF
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex flex-col flex-grow">
                  <h3
                    className={`text-xl font-semibold ${darkMode ? 'text-light' : 'text-gray-800'} mb-2 transition-colors duration-300`}
                  >
                    {product.name}
                  </h3>
                  <p
                    className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-4 flex-grow transition-colors duration-300`}
                  >
                    {product.description}
                  </p>
                  <div className="space-y-4 mt-auto">
                    <div className="flex justify-between items-center">
                      {hasDiscount ? (
                        <div>
                          <span className="text-gray-500 line-through text-sm mr-2">
                            ${product.price.toFixed(2)}
                          </span>
                          <span className="text-primary text-xl font-bold">
                            ${(product.price * (1 - product.discount!)).toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-primary text-xl font-bold">
                          ${product.price.toFixed(2)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <div
                        className={`flex items-center space-x-3 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg p-1 transition-colors duration-300`}
                      >
                        <button
                          onClick={() => handleQuantityChange(product.productId, -1)}
                          className={`w-8 h-8 flex items-center justify-center ${darkMode ? 'text-light' : 'text-gray-700'} hover:text-primary transition-colors duration-300`}
                          aria-label={`Decrease quantity of ${product.name}`}
                          id={`decrease-qty-${product.productId}`}
                        >
                          <span aria-hidden="true">-</span>
                        </button>
                        <span
                          className={`${darkMode ? 'text-light' : 'text-gray-800'} min-w-[2rem] text-center transition-colors duration-300`}
                          aria-label={`Quantity of ${product.name}`}
                          id={`qty-${product.productId}`}
                        >
                          {quantities[product.productId] || 0}
                        </span>
                        <button
                          onClick={() => handleQuantityChange(product.productId, 1)}
                          className={`w-8 h-8 flex items-center justify-center ${darkMode ? 'text-light' : 'text-gray-700'} hover:text-primary transition-colors duration-300`}
                          aria-label={`Increase quantity of ${product.name}`}
                          id={`increase-qty-${product.productId}`}
                        >
                          <span aria-hidden="true">+</span>
                        </button>
                      </div>
                      <button
                        onClick={() => handleAddToCart(product)}
                        className={`px-4 py-2 rounded-lg transition-colors ${quantities[product.productId]
                          ? 'bg-primary hover:bg-accent text-white'
                          : `${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'} cursor-not-allowed`
                          }`}
                        disabled={!quantities[product.productId]}
                        aria-label={`Add ${quantities[product.productId] || 0} ${product.name} to cart`}
                        id={`add-to-cart-${product.productId}`}
                      >
                        Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Product Modal */}
      {showModal && selectedProduct && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl transition-colors duration-300`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className={`${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-black'} transition-colors duration-300`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div
              className={`${darkMode ? 'bg-gradient-to-t from-gray-700 to-gray-800' : 'bg-gradient-to-t from-gray-100 to-white'} rounded-lg mb-6 p-4`}
            >
              <img
                src={`/${selectedProduct.imgName}`}
                alt={selectedProduct.name}
                className="w-full h-auto object-contain max-h-[400px]"
              />
            </div>
            <h2
              className={`text-2xl font-bold ${darkMode ? 'text-light' : 'text-gray-800'} mb-4 transition-colors duration-300`}
            >
              {selectedProduct.name}
            </h2>
            <p
              className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} text-lg transition-colors duration-300`}
            >
              {selectedProduct.description}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
