/**
 * Shared test utilities for Console dashboard render+interaction tests.
 *
 * Wraps the same provider chain that `client/src/App.tsx` mounts so a page
 * can render in isolation against jsdom without requiring the full app
 * shell. Each test gets a fresh QueryClient (no shared cache between tests).
 *
 * NV-OPT+UAT-2026-05-08 (T2 — Track-1.5 console test harness).
 */
import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface AllProvidersProps {
  children: React.ReactNode;
  queryClient?: QueryClient;
}

export function AllProviders({ children, queryClient }: AllProvidersProps) {
  const qc = queryClient ?? makeQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <Router>{children}</Router>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient }
) {
  const { queryClient, ...rest } = options ?? {};
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders queryClient={queryClient}>{children}</AllProviders>
    ),
    ...rest,
  });
}

export * from '@testing-library/react';
