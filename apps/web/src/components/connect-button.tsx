'use client';

import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { CHAIN_ID, config } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { shortAddress } from '@/lib/format';
import { useMounted } from '@/lib/hooks';
import { useI18n } from './i18n';
import { Button } from './ui';

export function ConnectButton({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const mounted = useMounted();
  const { t } = useI18n();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);

  if (!mounted) {
    return (
      <Button size={size} variant="outline" disabled>
        {t('wallet.connect')}
      </Button>
    );
  }
  if (isConnected && address) {
    if (chainId !== CHAIN_ID) {
      return (
        <Button
          size={size}
          variant="danger"
          disabled={switching}
          onClick={() => switchChainAsync({ chainId: CHAIN_ID }).catch((e) => setError(errorMessage(e, t)))}
          title={error ?? undefined}
        >
          {t('wallet.switch', { chain: config.chainLabel })}
        </Button>
      );
    }
    return (
      <div className="flex items-center gap-1">
        <span className="hidden h-8 items-center gap-2 rounded-lg border border-hairline-strong px-2.5 font-mono text-xs sm:inline-flex">
          <span className="size-1.5 rounded-full bg-ok" aria-hidden />
          {shortAddress(address)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => disconnect()}>
          {t('wallet.disconnect')}
        </Button>
      </div>
    );
  }
  // Prefer a wallet announced through EIP-6963, else the generic injected connector.
  const connector = connectors.find((c) => c.type === 'injected' && c.id !== 'injected') ?? connectors[0];
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size={size}
        variant="outline"
        disabled={isPending}
        onClick={async () => {
          setError(null);
          if (!connector) return setError(t('wallet.noProvider'));
          try {
            await connectAsync({ connector, chainId: CHAIN_ID });
          } catch (e) {
            setError(errorMessage(e, t));
          }
        }}
      >
        {isPending ? t('wallet.connecting') : t('wallet.connect')}
      </Button>
      {error ? (
        <span role="alert" className="max-w-64 text-danger text-xs">
          {error}
        </span>
      ) : null}
    </span>
  );
}
