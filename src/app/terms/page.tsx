import type { Metadata } from 'next';
import Link from 'next/link';
import { ko } from '@/lib/i18n';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: `${ko.terms.title} · ${ko.app.title}`,
};

export default function TermsPage() {
  return (
    <main className="min-h-dvh flex flex-col px-6">
      <article className="flex-1 mx-auto w-full max-w-lg py-10">
        <Link href="/" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
          ← {ko.legal.backHome}
        </Link>
        <h1 className="mt-4 text-2xl font-bold">{ko.terms.title}</h1>
        <p className="mt-1 text-xs text-zinc-500">{ko.legal.updated(ko.terms.updatedAt)}</p>
        <div className="mt-7 space-y-6">
          {ko.terms.sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-sm font-bold text-zinc-200">{s.h}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{s.body}</p>
            </section>
          ))}
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}
