'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Hash, TransactionReceipt, WalletClient } from 'viem';
import { waitForTransactionReceipt } from 'viem/actions';
import { useAccount, useConfig } from 'wagmi';
import { getWalletClient, switchChain } from 'wagmi/actions';
import { CHAIN_ID, explorerTx } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { shortHash } from '@/lib/format';
import { useClient } from '@/lib/queries';
import { useI18n } from './i18n';

export type TxPhase = 'idle' | 'confirm' | 'pending' | 'done' | 'error';
export interface TxState {
  phase: TxPhase;
  hash?: Hash;
  error?: string;
}

type Client = NonNullable<ReturnType<typeof useClient>>;

/**
 * Sends one transaction through the SDK: switches chain if needed, lets `send` build and sign it, waits for the receipt
 * and refreshes every query. Errors become one translated sentence.
 */
export function useTx() {
  const wagmi = useConfig();
  const client = useClient();
  const { isConnected, chainId } = useAccount();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [state, setState] = useState<TxState>({ phase: 'idle' });

  const run = useCallback(
    async (
      send: (client: Client, wallet: WalletClient) => Promise<Hash>,
    ): Promise<TransactionReceipt | null> => {
      if (!client || !isConnected) return null;
      setState({ phase: 'confirm' });
      try {
        if (chainId !== CHAIN_ID) await switchChain(wagmi, { chainId: CHAIN_ID });
        const wallet = await getWalletClient(wagmi, { chainId: CHAIN_ID });
        const hash = await send(client, wallet);
        setState({ phase: 'pending', hash });
        const receipt = await waitForTransactionReceipt(client, { hash });
        await queryClient.invalidateQueries();
        if (receipt.status !== 'success') {
          setState({ phase: 'error', hash, error: t('tx.reverted') });
          return null;
        }
        setState({ phase: 'done', hash });
        return receipt;
      } catch (e) {
        setState((s) => ({ phase: 'error', ...(s.hash ? { hash: s.hash } : {}), error: errorMessage(e, t) }));
        return null;
      }
    },
    [client, isConnected, chainId, wagmi, queryClient, t],
  );

  return {
    state,
    run,
    busy: state.phase === 'confirm' || state.phase === 'pending',
    reset: () => setState({ phase: 'idle' }),
  };
}

export function TxStatus({ state }: { state: TxState }) {
  const { t } = useI18n();
  if (state.phase === 'idle') return null;
  const href = state.hash ? explorerTx(state.hash) : null;
  const text =
    state.phase === 'confirm'
      ? t('tx.confirm')
      : state.phase === 'pending'
        ? t('tx.pending')
        : state.phase === 'done'
          ? t('tx.done')
          : (state.error ?? t('tx.reverted'));
  return (
    <p
      role={state.phase === 'error' ? 'alert' : 'status'}
      className={state.phase === 'error' ? 'text-danger text-sm' : 'text-muted text-sm'}
    >
      {text}{' '}
      {state.hash ? (
        href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-accent text-xs hover:underline"
          >
            {shortHash(state.hash)}
          </a>
        ) : (
          <span className="font-mono text-xs">{shortHash(state.hash)}</span>
        )
      ) : null}
    </p>
  );
}
