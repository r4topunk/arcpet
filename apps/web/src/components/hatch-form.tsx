'use client';

import { isValidName, MAX_NAME_LENGTH, sendHatch } from '@arcpet/sdk';
import { useId, useState } from 'react';
import { config } from '@/lib/config';
import { useI18n } from './i18n';
import { TxStatus, useTx } from './tx';
import { Button, Card } from './ui';

/** hatch(name): mints the egg and requests ArcDraw randomness. Name rule mirrors PetLib.isValidName (SPEC §5). */
export function HatchForm() {
  const { t } = useI18n();
  const inputId = useId();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const tx = useTx();
  const valid = isValidName(name);

  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold text-lg">{t('hatch.title')}</h2>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (!valid) return;
          // sendHatch returns at broadcast: useTx shows "pending" + the explorer link while the tx is mined.
          const receipt = await tx.run((client, wallet) =>
            sendHatch(client, wallet, { arcPet: config.arcPet!, name }),
          );
          if (receipt) setName('');
        }}
      >
        <label htmlFor={inputId} className="font-medium text-sm">
          {t('hatch.name')}
        </label>
        <input
          id={inputId}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !valid}
          aria-describedby={`${inputId}-hint`}
          className="h-11 rounded-lg border border-hairline-strong bg-surface px-3 font-mono outline-none focus:border-accent"
          placeholder="Mochi"
        />
        <p
          id={`${inputId}-hint`}
          className={touched && !valid ? 'text-danger text-xs' : 'text-muted text-xs'}
        >
          {touched && !valid ? t('hatch.invalidName') : t('hatch.nameHint')}
        </p>
        <div>
          <Button type="submit" size="lg" disabled={tx.busy}>
            {tx.busy ? t('hatch.sending') : t('hatch.submit')}
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </form>
    </Card>
  );
}
