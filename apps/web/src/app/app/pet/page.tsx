'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Page, RequireDeployment } from '@/components/chrome';
import { useDocumentTitle, useI18n } from '@/components/i18n';
import { PetView } from '@/components/pet-view';
import { Notice } from '@/components/ui';
import { parsePetId } from '@/lib/format';

function PetFromQuery() {
  const { t } = useI18n();
  const id = parsePetId(useSearchParams().get('id'));
  useDocumentTitle(id ? `#${id}` : null);
  if (id === null) return <Notice tone="danger">{t('pet.badId')}</Notice>;
  return <PetView id={id} />;
}

export default function PetPage() {
  const { t } = useI18n();
  return (
    <Page>
      <RequireDeployment>
        <Suspense fallback={<p className="text-muted">{t('state.loading')}</p>}>
          <PetFromQuery />
        </Suspense>
      </RequireDeployment>
    </Page>
  );
}
