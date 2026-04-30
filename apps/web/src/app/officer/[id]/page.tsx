export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getOfficer,
  getOfficerAppointments,
  getOfficerFromChRest,
  type ChRestOfficerProfile,
} from "@/lib/db";
import { formatDate, companyStatusClass } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const officer = await getOfficer(id);
  if (officer) return { title: officer.nameFull };
  const rest = await getOfficerFromChRest(id);
  if (rest) return { title: rest.nameFull };
  return { title: "Officer not found" };
}

export default async function OfficerPage({ params }: Props) {
  const { id } = await params;
  const [officer, appointments] = await Promise.all([
    getOfficer(id),
    getOfficerAppointments(id),
  ]);

  if (officer) {
    // Local DB path
    const active = appointments.filter((a) => !a.resignedOn);
    const former = appointments.filter((a) => a.resignedOn);
    return <LocalOfficerProfile officer={officer} active={active} former={former} />;
  }

  // CH REST fallback for officers not yet in local DB
  const restProfile = await getOfficerFromChRest(id);
  if (!restProfile) notFound();

  return <RestOfficerProfile profile={restProfile} />;
}

// ─── Local DB profile ──────────────────────────────────────

function LocalOfficerProfile({
  officer,
  active,
  former,
}: {
  officer: Awaited<ReturnType<typeof getOfficer>>;
  active: Awaited<ReturnType<typeof getOfficerAppointments>>;
  former: Awaited<ReturnType<typeof getOfficerAppointments>>;
}) {
  if (!officer) return null;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-10">
      <OfficerHeader
        nameFull={officer.nameFull}
        occupation={officer.occupation}
        nationality={officer.nationality}
        countryOfResidence={officer.countryOfResidence}
        address={null}
        dateOfBirthYear={officer.dateOfBirthYear}
        dateOfBirthMonth={officer.dateOfBirthMonth}
      />
      <div className="border-t border-[var(--border-subtle)]" />
      <AppointmentsSection
        active={active.map((a) => ({
          companyNumber: a.companyNumber,
          companyName: a.companyName,
          companyStatus: a.companyStatus,
          role: a.role,
          appointedOn: a.appointedOn ? String(a.appointedOn) : null,
          resignedOn: null,
        }))}
        former={former.map((a) => ({
          companyNumber: a.companyNumber,
          companyName: a.companyName,
          companyStatus: a.companyStatus,
          role: a.role,
          appointedOn: a.appointedOn ? String(a.appointedOn) : null,
          resignedOn: a.resignedOn ? String(a.resignedOn) : null,
        }))}
      />
    </div>
  );
}

// ─── CH REST profile ───────────────────────────────────────

function RestOfficerProfile({ profile }: { profile: ChRestOfficerProfile }) {
  const active = profile.appointments.filter((a) => !a.resignedOn);
  const former = profile.appointments.filter((a) => a.resignedOn);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-10">
      <div className="rounded-md border border-amber-900 bg-amber-950/50 px-4 py-2.5 text-xs text-amber-400 font-mono">
        ↗ Fetched live from Companies House — not yet in local database.
        Profile will populate automatically as events stream through.
      </div>
      <OfficerHeader
        nameFull={profile.nameFull}
        occupation={profile.occupation}
        nationality={profile.nationality}
        countryOfResidence={null}
        address={profile.address}
        dateOfBirthYear={profile.dateOfBirthYear}
        dateOfBirthMonth={profile.dateOfBirthMonth}
      />
      <div className="border-t border-[var(--border-subtle)]" />
      <AppointmentsSection active={active} former={former} />
    </div>
  );
}

// ─── Shared sub-components ─────────────────────────────────

function OfficerHeader({
  nameFull,
  occupation,
  nationality,
  countryOfResidence,
  address,
  dateOfBirthYear,
  dateOfBirthMonth,
}: {
  nameFull: string;
  occupation: string | null;
  nationality: string | null;
  countryOfResidence: string | null;
  address: string | null;
  dateOfBirthYear: number | null;
  dateOfBirthMonth: number | null;
}) {
  return (
    <div className="space-y-3">
      <p className="section-label">Person</p>
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">{nameFull}</h1>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
        {occupation && <span>{occupation}</span>}
        {nationality && <span>{nationality}</span>}
        {countryOfResidence && <span>Resident: {countryOfResidence}</span>}
        {address && <span>{address}</span>}
        {dateOfBirthYear && (
          <span>
            b.{" "}
            {dateOfBirthMonth
              ? new Date(dateOfBirthYear, dateOfBirthMonth - 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
              : dateOfBirthYear}
          </span>
        )}
      </div>
    </div>
  );
}

type AppointmentItem = {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
};

function AppointmentsSection({
  active,
  former,
}: {
  active: AppointmentItem[];
  former: AppointmentItem[];
}) {
  return (
    <>
      <section className="space-y-3">
        <h2 className="section-label">Current appointments · {active.length}</h2>
        {active.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No current appointments.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            {active.map((a, i) => (
              <AppointmentRow key={i} a={a} />
            ))}
          </div>
        )}
      </section>

      {former.length > 0 && (
        <section className="space-y-3">
          <details>
            <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors select-none font-mono uppercase tracking-wide">
              {former.length} former appointment{former.length !== 1 ? "s" : ""} ▸
            </summary>
            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] opacity-60">
              {former.map((a, i) => (
                <AppointmentRow key={i} a={a} resigned />
              ))}
            </div>
          </details>
        </section>
      )}
    </>
  );
}

function AppointmentRow({ a, resigned = false }: { a: AppointmentItem; resigned?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/c/${a.companyNumber}`}
            className={`font-medium hover:text-[var(--accent)] transition-colors ${resigned ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}
          >
            {a.companyName || a.companyNumber}
          </Link>
          <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{a.companyNumber}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <span className="badge border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
            {a.role}
          </span>
          {!resigned && (
            <span className={`badge border ${companyStatusClass(a.companyStatus)}`}>
              {a.companyStatus}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
        {resigned
          ? `${formatDate(a.appointedOn)} – ${formatDate(a.resignedOn)}`
          : `Appointed ${formatDate(a.appointedOn)}`}
      </div>
    </div>
  );
}
