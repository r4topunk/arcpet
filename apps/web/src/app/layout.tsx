import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/chrome';
import { Providers } from '@/components/providers';
import { config } from '@/lib/config';
import './globals.css';

const description =
  'Hatch a pet with ArcDraw genes, keep it fed and happy, and if nobody cares, it dies for good. Onchain on Arc.';

export const metadata: Metadata = {
  metadataBase: new URL(`${config.siteUrl}/`),
  title: { default: 'ArcPet: an onchain pet on Arc', template: '%s · ArcPet' },
  description,
  applicationName: 'ArcPet',
  openGraph: { type: 'website', siteName: 'ArcPet', title: 'ArcPet: an onchain pet on Arc', description },
};

export const viewport: Viewport = { themeColor: '#ffffff', colorScheme: 'light' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh overflow-x-clip antialiased">
        <Providers>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
