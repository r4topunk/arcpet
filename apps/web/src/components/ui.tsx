import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90 border border-transparent',
  outline: 'border border-hairline-strong bg-surface text-foreground hover:bg-surface-2',
  ghost: 'border border-transparent text-muted hover:text-foreground hover:bg-surface-2',
  danger: 'bg-danger text-white hover:bg-danger/90 border border-transparent',
};

export function buttonClass(variant: Variant = 'primary', size: 'sm' | 'md' | 'lg' = 'md') {
  return cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' && 'h-8 px-3 text-sm',
    size === 'md' && 'h-10 px-4 text-sm',
    size === 'lg' && 'h-12 px-5 text-base',
    VARIANTS[variant],
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return <button type="button" className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-hairline-strong bg-surface p-5', className)}>
      {children}
    </section>
  );
}

export function Notice({
  children,
  tone = 'info',
  className,
}: {
  children: ReactNode;
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  className?: string;
}) {
  const tones = {
    info: 'bg-surface-2 text-foreground',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    ok: 'bg-ok-soft text-ok',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl px-4 py-3 text-sm', tones[tone], className)}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
      {lead ? <p className="mt-2 max-w-2xl text-muted">{lead}</p> : null}
    </div>
  );
}
