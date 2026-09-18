'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { config } from '@/lib/config';
import type { MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ConnectButton } from './connect-button';
import { LocaleToggle, useI18n } from './i18n';
import { Card } from './ui';

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 12 12" className="size-7" shapeRendering="crispEdges" aria-hidden>
        <rect width="12" height="12" rx="3" className="fill-accent" />
        <path d="M3 3h6v1h1v4h-1v1h-6v-1h-1v-4h1z" fill="#fff" />
        <path d="M4 5h1v1h-1zM7 5h1v1h-1zM5 7h2v1h-2z" fill="#1d1b26" />
      </svg>
      <span className="font-semibold text-base tracking-tight">ArcPet</span>
    </span>
  );
}

const NAV: { href: string; key: MessageKey; match: (p: string) => boolean }[] = [
  { href: '/app/', key: 'nav.myPet', match: (p) => /\/app\/?$/.test(p) },
  { href: '/app/ranking/', key: 'nav.ranking', match: (p) => p.includes('/app/ranking') },
  { href: '/app/graveyard/', key: 'nav.graveyard', match: (p) => p.includes('/app/graveyard') },
];

export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname() ?? '';
  const links = NAV.map((n) => {
    const active = n.match(pathname);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors',
          active ? 'bg-surface-2 font-medium text-foreground' : 'text-muted hover:text-foreground',
        )}
      >
        {t(n.key)}
      </Link>
    );
  });
  return (
    <header className="sticky top-0 z-40 border-hairline border-b bg-background/90 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:rounded focus:bg-foreground focus:px-3 focus:py-1 focus:text-background"
      >
        {t('nav.skip')}
      </a>
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:px-6">
        <Link href="/app/" aria-label={t('nav.home')} className="mr-3 shrink-0">
          <Logo />
        </Link>
        <nav aria-label={t('nav.main')} className="hidden items-center gap-1 md:flex">
          {links}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle />
          <ConnectButton />
        </div>
      </div>
      <nav
        aria-label={t('nav.main')}
        className="flex gap-1 overflow-x-auto border-hairline border-t px-3 py-1.5 md:hidden"
      >
        {links}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-24 border-hairline border-t">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-muted text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-xl">{t('footer.note')}</p>
        <div className="flex gap-4">
          <a href={`${config.siteUrl}/`} className="hover:text-foreground">
            {t('nav.project')}
          </a>
          <a href={config.repoUrl} className="hover:text-foreground" target="_blank" rel="noreferrer">
            {t('nav.github')}
          </a>
        </div>
      </div>
    </footer>
  );
}

/** Wraps every view that reads ArcPet: shows "not deployed yet" while the address is unset (zero/placeholder). */
export function RequireDeployment({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      {config.problems.length > 0 ? (
        <div className="mb-6 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <strong>{t('state.config')}</strong> {config.problems.join(' ')}
        </div>
      ) : null}
      {config.arcPet ? (
        children
      ) : (
        <Card className="max-w-xl">
          <h2 className="font-semibold text-lg">{t('state.notDeployed.title')}</h2>
          <p className="mt-2 text-muted text-sm">
            {t('state.notDeployed.body', { chain: config.chainLabel })}
          </p>
        </Card>
      )}
    </>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</div>;
}
