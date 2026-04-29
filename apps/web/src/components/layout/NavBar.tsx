import Link from "next/link";
import SearchBox from "@/components/ui/SearchBox";

export default function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link
          href="/"
          className="shrink-0 font-mono text-sm font-bold tracking-tight text-gray-900"
        >
          companieshouse.watch
        </Link>

        <div className="flex-1">
          <SearchBox />
        </div>

        <nav className="hidden items-center gap-1 text-sm sm:flex">
          <Link
            href="/feed"
            className="rounded px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            Live feed
          </Link>
          <Link
            href="/about"
            className="rounded px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}
