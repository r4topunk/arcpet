'use client';

import { Page, RequireDeployment } from '@/components/chrome';
import { useDocumentTitle, useI18n } from '@/components/i18n';
import { PetList } from '@/components/pet-list';
import { PageHeader } from '@/components/ui';

export default function RankingPage() {
  const { t } = useI18n();
  useDocumentTitle(t('ranking.title'));
  return (
    <Page>
      <PageHeader title={t('ranking.title')} />
      <RequireDeployment>
        <PetList mode="ranking" />
      </RequireDeployment>
    </Page>
  );
}
