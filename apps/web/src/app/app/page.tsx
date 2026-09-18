'use client';

import { livePet, Status } from '@arcpet/sdk';
import { useAccount } from 'wagmi';
import { Page, RequireDeployment } from '@/components/chrome';
import { ConnectButton } from '@/components/connect-button';
import { HatchForm } from '@/components/hatch-form';
import { useDocumentTitle, useI18n } from '@/components/i18n';
import { PetView } from '@/components/pet-view';
import { Card, Notice, PageHeader } from '@/components/ui';
import { config } from '@/lib/config';
import { useMounted, useNow } from '@/lib/hooks';
import { useMyPet } from '@/lib/queries';

function MyPet() {
  const { t } = useI18n();
  const mounted = useMounted();
  const now = useNow(5_000);
  const { address, isConnected } = useAccount();
  const my = useMyPet(address);

  if (!mounted) return <p className="text-muted">{t('state.loading')}</p>;
  if (!isConnected || !address) {
    return (
      <Card className="flex max-w-xl flex-col items-start gap-4">
        <p>{t('my.connect')}</p>
        <ConnectButton size="md" />
      </Card>
    );
  }
  if (my.error) {
    return (
      <Notice tone="danger">
        {t('state.rpcError', { rpc: config.rpcUrl })}{' '}
        <button type="button" className="underline" onClick={() => my.refetch()}>
          {t('state.retry')}
        </button>
      </Notice>
    );
  }
  if (my.isLoading || now === null) return <p className="text-muted">{t('state.loading')}</p>;

  const pet = my.data ? livePet(my.data, now) : null;
  if (!pet) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-muted">{t('my.none')}</p>
        <HatchForm />
      </div>
    );
  }
  if (pet.status === Status.Dead || pet.status === Status.Buried) {
    return (
      <div className="flex flex-col gap-6">
        <Notice>{t('my.again')}</Notice>
        <HatchForm />
        <h2 className="eyebrow mt-4">{t('my.previous')}</h2>
        <PetView id={pet.id} showPageLink />
      </div>
    );
  }
  return <PetView id={pet.id} showPageLink />;
}

export default function MyPetPage() {
  const { t } = useI18n();
  useDocumentTitle(t('my.title'));
  return (
    <Page>
      <PageHeader title={t('my.title')} lead={t('app.lead')} />
      <RequireDeployment>
        <MyPet />
      </RequireDeployment>
    </Page>
  );
}
