import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from 'react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import Products from './Products';
import { ThemeProvider } from '../../../context/ThemeContext';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

const products = [
  {
    productId: 1,
    name: 'SmartFeeder One',
    description: 'Automated feeder',
    price: 129.99,
    discount: 0.25,
    imgName: 'feeder.png',
    sku: 'CAT-FEED-001',
    unit: 'piece',
    supplierId: 1,
  },
  {
    productId: 2,
    name: 'Cat Toy',
    description: 'Interactive toy',
    price: 19.99,
    discount: 0,
    imgName: 'toy.png',
    sku: 'TOY-100',
    unit: 'piece',
    supplierId: 1,
  },
];

const mockAxiosGet = vi.mocked(axios.get);

function renderProducts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Products />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('Products search and filtering', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAxiosGet.mockImplementation(async (url, config) => {
      if (String(url).endsWith('/cart')) {
        return {
          data: { cartId: 'test-cart', items: [], itemCount: 0, total: 0 },
        };
      }

      const params = config?.params as Record<string, string> | undefined;
      const query = params?.q?.toLowerCase();
      const minPrice = params?.minPrice ? Number(params.minPrice) : undefined;
      const maxPrice = params?.maxPrice ? Number(params.maxPrice) : undefined;
      const filtered = products.filter((product) => {
        const effectivePrice = product.price * (1 - product.discount);
        const matchesQuery =
          !query ||
          product.name.toLowerCase().includes(query) ||
          product.sku.toLowerCase().includes(query) ||
          product.description.toLowerCase().includes(query);
        return (
          matchesQuery &&
          (minPrice === undefined || effectivePrice >= minPrice) &&
          (maxPrice === undefined || effectivePrice <= maxPrice)
        );
      });

      return { data: filtered };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('sends search text to the API and shows matching results', async () => {
    renderProducts();

    await screen.findByRole('heading', { name: 'SmartFeeder One' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search products' }), {
      target: { value: 'cat-feed-001' },
    });

    expect(await screen.findByRole('heading', { name: 'SmartFeeder One' })).toBeVisible();
    await waitFor(() => {
      expect(mockAxiosGet).toHaveBeenLastCalledWith(
        expect.stringMatching(/\/api\/products$/),
        { params: { q: 'cat-feed-001' } },
      );
    });
    expect(screen.queryByRole('heading', { name: 'Cat Toy' })).not.toBeInTheDocument();
  });

  it('sends price filters to the API and clears filters to restore products', async () => {
    const user = userEvent.setup();
    renderProducts();

    await screen.findByRole('heading', { name: 'SmartFeeder One' });
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '100' } });

    expect(await screen.findByRole('heading', { name: 'Cat Toy' })).toBeVisible();
    await waitFor(() => {
      expect(mockAxiosGet).toHaveBeenLastCalledWith(
        expect.stringMatching(/\/api\/products$/),
        { params: { maxPrice: '100' } },
      );
    });
    expect(screen.queryByRole('heading', { name: 'Cat Toy' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('heading', { name: 'SmartFeeder One' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Cat Toy' })).toBeVisible();
    await waitFor(() => {
      expect(mockAxiosGet).toHaveBeenLastCalledWith(
        expect.stringMatching(/\/api\/products$/),
        { params: {} },
      );
    });
  });

  it('shows validation feedback and avoids searching an invalid price range', async () => {
    renderProducts();
    await screen.findByRole('heading', { name: 'SmartFeeder One' });

    fireEvent.change(screen.getByLabelText('Minimum price'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '20' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter non-negative prices, with the minimum no greater than the maximum.',
    );
    expect(mockAxiosGet).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/api\/products$/),
      { params: { minPrice: '100' } },
    );
  });
});
