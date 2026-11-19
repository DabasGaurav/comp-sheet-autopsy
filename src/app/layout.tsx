import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Comp Sheet Autopsy — a concept for Everstage Growth",
  description: "Drop a commission spreadsheet. Every payout is recomputed deterministically and reconciled. Concept build by Gaurav Dabas; not an Everstage product.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-6">
            <Link href="/" className="font-serif text-lg font-semibold tracking-tight">
              Comp Sheet <span className="italic">Autopsy</span>
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-ink">Autopsy</Link>
              <Link href="/bdr" className="hover:text-ink">BDR queue</Link>
              <Link href="/metrics" className="hover:text-ink">Metrics</Link>
              <Link href="/eval" className="hover:text-ink">Eval</Link>
            </nav>
            <span className="ml-auto text-[11px] text-muted border border-line rounded-full px-3 py-1 bg-white">
              Concept by Gaurav Dabas for Everstage&apos;s Growth team · not an Everstage product
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 text-xs text-muted">
          Sample workbooks are synthetic and illustrative. Uploaded rows are parsed in your browser; only plan text and column headers are sent to the model. The model reads text — every dollar is computed by deterministic code.{" "}
          <a className="underline" href="https://github.com/DabasGaurav/comp-sheet-autopsy">Source on GitHub</a>
        </footer>
      </body>
    </html>
  );
}
