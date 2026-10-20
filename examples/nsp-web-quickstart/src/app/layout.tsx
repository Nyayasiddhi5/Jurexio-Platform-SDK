import type { ReactNode } from 'react';
import { JrxProvider } from './providers';

export const metadata = {
  title: 'JRX Web Quickstart — @jurexio/client-sdk 5.x',
  description: 'Reference Next.js app demonstrating @jurexio/client-sdk@5.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#fafafa' }}>
        <JrxProvider>
          <header style={{ padding: '16px 24px', borderBottom: '1px solid #e5e5e5', background: '#fff' }}>
            <strong>NSP Web Quickstart</strong>
            <span style={{ marginLeft: 8, color: '#888', fontSize: 13 }}>
              @jurexio/client-sdk 5.x — chat · documents · voice · intelligence · streaming
            </span>
          </header>
          <main style={{ maxWidth: 920, margin: '0 auto', padding: '24px' }}>
            {children}
          </main>
        </JrxProvider>
      </body>
    </html>
  );
}
