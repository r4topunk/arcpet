import { createConfig, createStorage, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { chain, config } from './config';
import { safeGet, safeRemove, safeSet } from './storage';

/** One chain, any injected EIP-1193 wallet. No WalletConnect, no analytics. Storage degrades when blocked. */
export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [chain.id]: http(config.rpcUrl, { retryCount: 1, timeout: 15_000 }) },
  storage: createStorage({
    storage: { getItem: safeGet, setItem: (k, v) => void safeSet(k, v), removeItem: safeRemove },
  }),
  ssr: true,
  multiInjectedProviderDiscovery: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
