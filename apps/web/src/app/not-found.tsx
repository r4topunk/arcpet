import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <h1 className="font-semibold text-3xl tracking-tight">404</h1>
      <p className="mt-2 text-muted">This page does not exist.</p>
      <Link href="/app/" className="mt-6 inline-block text-accent hover:underline">
        ArcPet
      </Link>
    </div>
  );
}
