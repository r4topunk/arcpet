'use client';

import { Page, RequireDeployment } from '@/components/chrome';
import { useDocumentTitle, useI18n } from '@/components/i18n';
import { PetList } from '@/components/pet-list';
import { PageHeader } from '@/components/ui';

export default function GraveyardPage() {
  const { t } = useI18n();
  useDocumentTitle(t('graveyard.title'));
  return (
    <Page>
      <PageHeader title={t('graveyard.title')} />
      <RequireDeployment>
        <PetList mode="graveyard" />
      </RequireDeployment>
    </Page>
  );
}
