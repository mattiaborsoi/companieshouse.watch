import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNowStrict } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM yyyy");
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true });
}

export function companyStatusClass(status: string): string {
  switch (status?.toLowerCase()) {
    case "active":
      return "bg-emerald-950 text-emerald-400 border-emerald-800";
    case "dissolved":
      return "bg-zinc-900 text-zinc-500 border-zinc-700";
    case "liquidation":
      return "bg-red-950 text-red-400 border-red-800";
    case "administration":
      return "bg-orange-950 text-orange-400 border-orange-800";
    default:
      return "bg-yellow-950 text-yellow-400 border-yellow-800";
  }
}

// More legible short labels for display
export function filingCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    accounts:                           "Accounts",
    "confirmation-statement":           "CS01",
    confirmation_statement:             "CS01",
    incorporation:                      "Incorp",
    officers:                           "Officers",
    address:                            "Address",
    mortgage:                           "Charges",
    insolvency:                         "Insolvency",
    dissolution:                        "Dissolution",
    "persons-with-significant-control": "PSC",
    capital:                            "Capital",
    resolution:                         "Resolution",
    "annual-return":                    "Annual Rtn",
    "change-of-name":                   "Name Chg",
  };
  return labels[category] ?? category;
}

// Bold, high-contrast category colors
export function filingCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    accounts:                           "bg-blue-950  text-blue-300   border-blue-700",
    "confirmation-statement":           "bg-violet-950 text-violet-300 border-violet-700",
    confirmation_statement:             "bg-violet-950 text-violet-300 border-violet-700",
    incorporation:                      "bg-emerald-950 text-emerald-300 border-emerald-700",
    officers:                           "bg-orange-950 text-orange-300 border-orange-700",
    address:                            "bg-teal-950   text-teal-300   border-teal-700",
    mortgage:                           "bg-red-950    text-red-300    border-red-700",
    insolvency:                         "bg-red-950    text-red-300    border-red-700",
    dissolution:                        "bg-zinc-900   text-zinc-400   border-zinc-600",
    "persons-with-significant-control": "bg-indigo-950 text-indigo-300 border-indigo-700",
    capital:                            "bg-sky-950    text-sky-300    border-sky-700",
    resolution:                         "bg-amber-950  text-amber-300  border-amber-700",
    "change-of-name":                   "bg-pink-950   text-pink-300   border-pink-700",
  };
  return colors[category] ?? "bg-zinc-900 text-zinc-400 border-zinc-600";
}
