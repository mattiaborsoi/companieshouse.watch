import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center px-4">
      <div className="font-mono text-6xl font-bold text-[var(--border)] select-none">404</div>
      <p className="text-[var(--text-secondary)]">Page not found.</p>
      <Link href="/" className="btn-ghost text-sm">
        ← Back to home
      </Link>
    </div>
  );
}
