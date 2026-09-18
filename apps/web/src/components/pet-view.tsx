'use client';

import {
  buildReminderIcs,
  livePet,
  type PetInfo,
  reminderFileName,
  reminderStart,
  revertErrorName,
  Status,
  sendPetAction,
  statBelowAt,
} from '@arcpet/sdk';
import Link from 'next/link';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { config, explorerAddress, petPath, petUrl } from '@/lib/config';
import { formatDateTime, formatDuration, shortAddress } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { MessageKey } from '@/lib/i18n';
import { usePet, useTokenMetadata } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { EggPanel } from './egg-panel';
import { useI18n } from './i18n';
import { TxStatus, useTx } from './tx';
import { Button, Card, Notice } from './ui';

const STATUS_KEY: Record<Status, MessageKey> = {
  0: 'status.Egg',
  1: 'status.Egg',
  2: 'status.Alive',
  3: 'status.Dead',
  4: 'status.Buried',
};
const MOOD_KEY = ['mood.Egg', 'mood.Happy', 'mood.Hungry', 'mood.Sad', 'mood.Tomb'] as const;
const SPECIES_KEY = ['species.0', 'species.1', 'species.2', 'species.3'] as const;

export function StatusChip({ status }: { status: Status }) {
  const { t } = useI18n();
  const tone =
    status === Status.Alive
      ? 'bg-ok-soft text-ok'
      : status === Status.Dead
        ? 'bg-danger-soft text-danger'
        : status === Status.Buried
          ? 'bg-surface-2 text-muted'
          : 'bg-warn-soft text-warn';
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 font-medium text-xs', tone)}>
      {t(STATUS_KEY[status])}
    </span>
  );
}

export function StatBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 30 ? 'bg-ok' : value > 0 ? 'bg-warn' : 'bg-danger';
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tnum font-mono text-muted text-xs">{value}/100</span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a styled bar; native <meter> cannot be themed across browsers */}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-3 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700', tone)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/** The onchain SVG from tokenURI (rendered as an <img>, so it cannot run script). */
export function PetArt({ pet, className }: { pet: PetInfo; className?: string }) {
  const { t } = useI18n();
  const version = `${pet.status}-${pet.mood}-${pet.lastFed}-${pet.lastPlayed}-${pet.diedAt}-${pet.bornAt}`;
  const meta = useTokenMetadata(pet.id, version);
  return (
    <div
      className={cn(
        'aspect-square overflow-hidden rounded-2xl border border-hairline-strong bg-surface-2',
        className,
      )}
    >
      {meta.data ? (
        // biome-ignore lint/performance/noImgElement: data: URI from tokenURI; static export has no image optimizer
        <img
          src={meta.data.image}
          alt={t('pet.image', { name: pet.name })}
          className="size-full"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="grid size-full place-items-center text-muted text-sm">{t('state.loading')}</div>
      )}
    </div>
  );
}

function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Full pet card: art, live bars (ticking client-side from petInfo), actions anyone can take, reminder, share. */
export function PetView({ id, showPageLink = false }: { id: bigint; showPageLink?: boolean }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const { address, isConnected } = useAccount();
  const query = usePet(id);
  const tx = useTx();
  const [copied, setCopied] = useState(false);

  if (query.error) {
    const notFound = revertErrorName(query.error) === 'NonexistentPet';
    return (
      <Notice tone="danger">
        {notFound ? t('pet.notFound', { id: id.toString() }) : t('state.rpcError', { rpc: config.rpcUrl })}{' '}
        {!notFound ? (
          <button type="button" className="underline" onClick={() => query.refetch()}>
            {t('state.retry')}
          </button>
        ) : null}
      </Notice>
    );
  }
  if (!query.data || now === null) return <p className="text-muted">{t('state.loading')}</p>;

  const pet = livePet(query.data, now);
  const mine = !!address && address.toLowerCase() === pet.owner.toLowerCase();
  const act = (action: 'feed' | 'play' | 'bury') =>
    tx.run((client, wallet) => sendPetAction(client, wallet, { arcPet: config.arcPet!, id, action }));
  const ownerLink = explorerAddress(pet.owner);

  return (
    <Card className="grid gap-6 md:grid-cols-[minmax(0,280px)_1fr]">
      <PetArt pet={pet} />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-2xl tracking-tight">
            {t('pet.title', { name: pet.name, id: pet.id.toString() })}
          </h2>
          <StatusChip status={pet.status} />
          {pet.status === Status.Alive ? (
            <span className="text-muted text-sm">{t(MOOD_KEY[pet.mood])}</span>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="eyebrow">{t('pet.owner')}</dt>
            <dd className="font-mono text-xs">
              {ownerLink ? (
                <a href={ownerLink} target="_blank" rel="noreferrer" className="hover:underline">
                  {shortAddress(pet.owner)}
                </a>
              ) : (
                shortAddress(pet.owner)
              )}
              {mine ? <span className="ml-1 text-accent">({t('pet.you')})</span> : null}
            </dd>
          </div>
          {pet.status !== Status.Egg ? (
            <>
              <div>
                <dt className="eyebrow">{t('pet.species')}</dt>
                <dd>{t(SPECIES_KEY[pet.species] ?? 'species.0')}</dd>
              </div>
              <div>
                <dt className="eyebrow">{t('pet.age')}</dt>
                <dd className="tnum">{formatDuration(pet.age)}</dd>
              </div>
            </>
          ) : null}
        </dl>

        {pet.status === Status.Egg ? <EggPanel pet={pet} /> : null}

        {pet.status === Status.Alive ? (
          <>
            <div className="flex flex-col gap-3">
              <StatBar label={t('pet.hunger')} value={pet.hunger} />
              <StatBar label={t('pet.happiness')} value={pet.happiness} />
            </div>
            <div className="text-sm">
              <p>
                <span className="eyebrow mr-2">{t('pet.diesIn')}</span>
                <span className="tnum font-medium font-mono">{formatDuration(pet.deathAt - now)}</span>
              </p>
              <p className="text-muted">
                {t('pet.diesAt', { date: formatDateTime(pet.deathAt, locale) })}
                {' · '}
                {pet.hunger >= 30
                  ? t('pet.hungryIn', {
                      time: formatDuration(statBelowAt(pet.lastFed, pet.hungerWindow) - now),
                    })
                  : null}
                {pet.hunger >= 30 && pet.happiness >= 30 ? ' · ' : null}
                {pet.happiness >= 30
                  ? t('pet.sadIn', {
                      time: formatDuration(statBelowAt(pet.lastPlayed, pet.playWindow) - now),
                    })
                  : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!isConnected || tx.busy} onClick={() => act('feed')}>
                {t('pet.feed')}
              </Button>
              <Button disabled={!isConnected || tx.busy} onClick={() => act('play')}>
                {t('pet.play')}
              </Button>
              {/* Hidden when death is too close for a reminder that fires before it (the SDK would refuse). */}
              {reminderStart(pet.deathAt, now) !== null ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadText(
                      buildReminderIcs({
                        petId: pet.id,
                        name: pet.name,
                        deathAt: pet.deathAt,
                        // chain clock: the event start and its alarm are never in the past
                        now: new Date(Number(now) * 1000),
                        url: petUrl(pet.id),
                        summary: t('ics.summary'),
                        description: t('ics.description'),
                      }),
                      reminderFileName(pet.id),
                      'text/calendar;charset=utf-8',
                    )
                  }
                  title={t('pet.calendarHint')}
                >
                  {t('pet.calendar')}
                </Button>
              ) : null}
            </div>
            <p className="text-muted text-xs">{t('pet.calendarHint')}</p>
          </>
        ) : null}

        {pet.status === Status.Dead ? (
          <>
            <Notice tone="danger">{t('pet.deadUnburied', { time: formatDuration(pet.age) })}</Notice>
            <div>
              <Button variant="outline" disabled={!isConnected || tx.busy} onClick={() => act('bury')}>
                {t('pet.bury')}
              </Button>
            </div>
          </>
        ) : null}

        {pet.status === Status.Buried ? (
          <p className="text-muted text-sm">
            {t('pet.died', { date: formatDateTime(pet.diedAt, locale) })} ·{' '}
            {t('pet.lived', { time: formatDuration(pet.age) })}
          </p>
        ) : null}

        {!isConnected && (pet.status === Status.Alive || pet.status === Status.Dead) ? (
          <p className="text-muted text-sm">{t('state.connectToAct')}</p>
        ) : null}
        <TxStatus state={tx.state} />

        <div className="mt-auto flex flex-wrap items-center gap-2 border-hairline border-t pt-4 text-sm">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(petUrl(pet.id));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? t('pet.copied') : t('pet.share')}
          </Button>
          {showPageLink ? (
            <Link href={petPath(pet.id)} className="text-accent hover:underline">
              {t('pet.openPage')}
            </Link>
          ) : null}
          {pet.status === Status.Alive ? (
            <span className="text-muted text-xs">{t('pet.anyoneCares')}</span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
