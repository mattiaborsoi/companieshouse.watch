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
      return "text-green-700 bg-green-50 border-green-200";
    case "dissolved":
      return "text-gray-500 bg-gray-50 border-gray-200";
    case "liquidation":
      return "text-red-700 bg-red-50 border-red-200";
    default:
      return "text-yellow-700 bg-yellow-50 border-yellow-200";
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
  };
  return labels[category] ?? category;
}

export function filingCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    accounts: "bg-blue-50 text-blue-700 border-blue-200",
    confirmation_statement: "bg-purple-50 text-purple-700 border-purple-200",
    incorporation: "bg-green-50 text-green-700 border-green-200",
    officers: "bg-orange-50 text-orange-700 border-orange-200",
    address: "bg-teal-50 text-teal-700 border-teal-200",
    mortgage: "bg-red-50 text-red-700 border-red-200",
    insolvency: "bg-red-100 text-red-800 border-red-300",
    dissolution: "bg-gray-100 text-gray-600 border-gray-300",
    "persons-with-significant-control": "bg-indigo-50 text-indigo-700 border-indigo-200",
  };
  return colors[category] ?? "bg-gray-50 text-gray-600 border-gray-200";
}
