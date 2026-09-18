'use client';

import Link from 'next/link';
import { useI18n } from '@/components/i18n';
import { buttonClass } from '@/components/ui';
import { config } from '@/lib/config';

/**
 * Local entry point only. On GitHub Pages the project page (site/index.html) is copied over this route's index.html,
 * so the app itself lives at /app/.
 */
export default function Home() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-24 sm:px-6">
      <span className="font-mono text-accent text-xs">{t('app.tagline')}</span>
      <h1 className="font-semibold text-5xl tracking-tight">ArcPet</h1>
      <p className="max-w-xl text-lg text-muted">{t('app.lead')}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/app/" className={buttonClass('primary', 'lg')}>
          {t('app.open')}
        </Link>
        <a href={config.repoUrl} className={buttonClass('outline', 'lg')}>
          {t('nav.github')}
        </a>
      </div>
    </div>
  );
}
