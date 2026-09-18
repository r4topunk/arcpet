'use client';

import { claimGenes, fulfillEgg, hatchPhase, type PetInfo, Status } from '@arcpet/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { config } from '@/lib/config';
import { formatDuration } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useHatchStatus } from '@/lib/queries';
import { useI18n } from './i18n';
import { TxStatus, useTx } from './tx';
import { Button, Notice } from './ui';

/**
 * Hatch flow for an egg (D9, R2, R8): wait for the pinned drand round -> "Hatch now" (fetch the signature from drand,
 * call coordinator.fulfill) -> if the callback failed and the request is Fulfilled, "Complete hatch" (claimGenes).
 * Anyone can do either step for any egg.
 */
export function EggPanel({ pet }: { pet: PetInfo }) {
  const { t } = useI18n();
  const now = useNow();
  const { isConnected } = useAccount();
  const status = useHatchStatus(pet.id, true);
  const tx = useTx();
  const queryClient = useQueryClient();
  // The hatch poll (3 s) sees a third-party fulfill/claimGenes long before the parent's petInfo poll (30 s): refresh
  // the pet queries so the parent switches from this panel to the live bars and actions right away.
  const hatchedElsewhere = status.data !== undefined && status.data.pet.status !== Status.Egg;
  useEffect(() => {
    if (!hatchedElsewhere) return;
    void queryClient.invalidateQueries({ queryKey: ['pet'] });
    void queryClient.invalidateQueries({ queryKey: ['petOf'] });
    void queryClient.invalidateQueries({ queryKey: ['tokenURI'] });
  }, [hatchedElsewhere, queryClient]);

  if (!status.data || now === null) return <p className="text-muted text-sm">{t('state.loading')}</p>;
  const { request } = status.data;
  // Re-derived on the chain clock every second (the query polls every 3 s and uses the local clock).
  const { phase, readyAt } = hatchPhase(status.data.pet.status, request, now);

  return (
    <div className="flex flex-col gap-3">
      {phase === 'waitingRound' ? (
        <Notice>
          {t('egg.waiting', { round: request.round.toString(), time: formatDuration(readyAt - now) })}
        </Notice>
      ) : null}
      {phase === 'fulfillable' ? (
        <>
          <Notice>{t('egg.fulfillable')}</Notice>
          <div>
            <Button
              size="lg"
              disabled={!isConnected || tx.busy}
              onClick={() =>
                tx.run((client, wallet) =>
                  fulfillEgg(client, wallet, { coordinator: config.coordinator, requestId: pet.requestId }),
                )
              }
            >
              {tx.busy ? t('egg.fulfilling') : t('egg.fulfill')}
            </Button>
          </div>
        </>
      ) : null}
      {phase === 'claimable' ? (
        <>
          <Notice tone="warn">{t('egg.claimable')}</Notice>
          <div>
            <Button
              size="lg"
              disabled={!isConnected || tx.busy}
              onClick={() =>
                tx.run((client, wallet) => claimGenes(client, wallet, { arcPet: config.arcPet!, id: pet.id }))
              }
            >
              {t('egg.claim')}
            </Button>
          </div>
        </>
      ) : null}
      {phase === 'hatched' ? <p className="text-muted text-sm">{t('state.loading')}</p> : null}
      {phase === 'unknownRequest' ? <Notice tone="danger">{t('egg.unknown')}</Notice> : null}
      {!isConnected && phase !== 'waitingRound' ? (
        <p className="text-muted text-sm">{t('state.connectToAct')}</p>
      ) : null}
      <TxStatus state={tx.state} />
      <p className="text-muted text-xs">{t('egg.never')}</p>
    </div>
  );
}
