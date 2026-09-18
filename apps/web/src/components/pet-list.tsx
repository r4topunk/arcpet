'use client';

import { graveyard, rankOldestAlive } from '@arcpet/sdk';
import Link from 'next/link';
import { useState } from 'react';
import { config, petPath } from '@/lib/config';
import { formatDuration, shortAddress } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useAllPets } from '@/lib/queries';
import { useI18n } from './i18n';
import { StatusChip } from './pet-view';
import { Notice } from './ui';

const SPECIES_KEY = ['species.0', 'species.1', 'species.2', 'species.3'] as const;

/** Ranking (oldest alive) or graveyard, from ids 1..totalSupply read by multicall (R5), re-evaluated every 10 s. */
export function PetList({ mode }: { mode: 'ranking' | 'graveyard' }) {
  const { t } = useI18n();
  const now = useNow(10_000);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const query = useAllPets((loaded, total) => setProgress([loaded, total]));

  if (query.error) {
    return (
      <Notice tone="danger">
        {t('state.rpcError', { rpc: config.rpcUrl })}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>
          {t('state.retry')}
        </button>
      </Notice>
    );
  }
  if (!query.data || now === null) {
    return (
      <p className="text-muted">
        {progress ? t('list.loaded', { loaded: progress[0], total: progress[1] }) : t('state.loading')}
      </p>
    );
  }
  const rows = mode === 'ranking' ? rankOldestAlive(query.data.pets, now) : graveyard(query.data.pets, now);
  return (
    <>
      <p className="mb-4 text-muted text-sm">
        {mode === 'ranking' ? t('ranking.lead', { total: query.data.total.toString() }) : t('graveyard.lead')}
      </p>
      {rows.length === 0 ? (
        <Notice>{mode === 'ranking' ? t('ranking.empty') : t('graveyard.empty')}</Notice>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-hairline-strong">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{t('list.rank')}</th>
                <th className="px-4 py-2 font-medium">{t('list.pet')}</th>
                <th className="px-4 py-2 font-medium">{t('list.age')}</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('list.owner')}</th>
                <th className="px-4 py-2 font-medium">{t('list.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id.toString()} className="border-hairline border-t">
                  <td className="tnum px-4 py-2 text-muted">{i + 1}</td>
                  <td className="px-4 py-2">
                    <Link href={petPath(p.id)} className="font-medium hover:text-accent hover:underline">
                      {p.name}
                    </Link>{' '}
                    <span className="text-muted text-xs">
                      #{p.id.toString()} · {t(SPECIES_KEY[p.species] ?? 'species.0')}
                    </span>
                  </td>
                  <td className="tnum px-4 py-2 font-mono text-xs">{formatDuration(p.age)}</td>
                  <td className="hidden px-4 py-2 font-mono text-xs sm:table-cell">
                    {shortAddress(p.owner)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
