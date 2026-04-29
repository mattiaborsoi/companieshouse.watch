import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM yyyy");
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return formatDistanceToNow(new Date(d), { addSuffix: true });
}

export function companyStatusClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-950 text-green-400 border-green-900";
    case "dissolved":
      return "bg-zinc-800 text-zinc-400 border-zinc-700";
    case "liquidation":
      return "bg-red-950 text-red-400 border-red-900";
    default:
      return "bg-yellow-950 text-yellow-400 border-yellow-900";
  }
}

export function filingCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    accounts: "Accounts",
    confirmation_statement: "Confirmation",
    incorporation: "Incorporation",
    officers: "Officers",
    address: "Address",
    mortgage: "Charges",
    insolvency: "Insolvency",
    dissolution: "Dissolution",
    "persons-with-significant-control": "PSC",
    capital: "Capital",
    resolution: "Resolution",
    "annual-return": "Annual Return",
  };
  return labels[category] ?? category;
}

export function filingCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    accounts:                           "bg-blue-950  text-blue-400   border-blue-900",
    confirmation_statement:             "bg-violet-950 text-violet-400 border-violet-900",
    incorporation:                      "bg-emerald-950 text-emerald-400 border-emerald-900",
    officers:                           "bg-orange-950 text-orange-400 border-orange-900",
    address:                            "bg-teal-950   text-teal-400   border-teal-900",
    mortgage:                           "bg-red-950    text-red-400    border-red-900",
    insolvency:                         "bg-red-950    text-red-400    border-red-900",
    dissolution:                        "bg-zinc-800   text-zinc-400   border-zinc-700",
    "persons-with-significant-control": "bg-indigo-950 text-indigo-400 border-indigo-900",
    capital:                            "bg-sky-950    text-sky-400    border-sky-900",
    resolution:                         "bg-amber-950  text-amber-400  border-amber-900",
  };
  return colors[category] ?? "bg-zinc-800 text-zinc-400 border-zinc-700";
}
