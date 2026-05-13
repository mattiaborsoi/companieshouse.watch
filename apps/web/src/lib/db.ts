import postgres from "postgres";
import Redis from "ioredis";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://chwatch:chwatch@localhost:5432/chwatch";

// Single connection pool shared across the process
const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: postgres.camel,
});

export default sql;

// ── Tiny Redis cache for expensive read-heavy queries that fire on every
// page render (NavBar getStatusBar, homepage getStats). Same idea as the
// ch-cache wrapper but for our own Postgres queries.
let _qcRedis: Redis | null = null;
function queryCacheRedis(): Redis | null {
  if (_qcRedis) return _qcRedis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    _qcRedis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      reconnectOnError: () => true,
    });
    _qcRedis.on("error", () => { /* silent — fall through to live query */ });
  } catch {
    _qcRedis = null;
  }
  return _qcRedis;
}

// Wraps an async function in a Redis-cached read with a TTL. Falls through
// to the live function on any cache miss or Redis error. JSON-safe outputs
// only (Date → ISO string in the cache; callers convert back if needed).
async function cachedQuery<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const redis = queryCacheRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* fall through */
    }
  }
  const result = await fn();
  if (redis) {
    redis.set(key, JSON.stringify(result), "EX", ttlSeconds).catch(() => { /* swallow */ });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Company {
  companyNumber: string;
  name: string;
  status: string;
  type: string;
  incorporatedOn: Date | null;
  dissolvedOn: Date | null;
  registeredAddress: Record<string, string>;
  registeredAddressPostcode: string | null;
  registeredAddressHash: string | null;
  sicCodes: string[];
  lastEventAt: Date;
}

export interface Filing {
  transactionId: string;
  companyNumber: string;
  category: string;
  type: string;
  description: string;
  filingDate: Date | null;
  paperFiled: boolean;
  hasPdf: boolean;
  ingestedAt: Date;
}

export interface Officer {
  officerId: string;
  forename: string | null;
  surname: string;
  nameFull: string;
  nationality: string | null;
  countryOfResidence: string | null;
  occupation: string | null;
  dateOfBirthYear: number | null;
  dateOfBirthMonth: number | null;
  chOfficerLink?: string | null;
}

export interface Appointment {
  companyNumber: string;
  officerId: string;
  role: string;
  appointedOn: Date | null;
  resignedOn: Date | null;
  officer?: Officer;
}

export interface Psc {
  chPscLink: string;
  companyNumber: string;
  kind: string;
  name: string | null;
  isAnonymised: boolean;
  naturesOfControl: string[];
  notifiedOn: Date | null;
  ceasedOn: Date | null;
  nationality: string | null;
  countryOfResidence: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getRecentFilings(limit = 50): Promise<(Filing & { companyName: string })[]> {
  return sql<(Filing & { companyName: string })[]>`
    SELECT
      f.transaction_id,
      f.company_number,
      f.category,
      f.type,
      f.description,
      f.filing_date,
      f.paper_filed,
      f.has_pdf,
      f.ingested_at,
      c.name AS company_name
    FROM public.filings f
    JOIN public.companies c USING (company_number)
    ORDER BY f.ingested_at DESC
    LIMIT ${limit}
  `;
}

export async function getRecentEvents(limit = 30): Promise<{
  resourceKind: string;
  resourceId: string;
  publishedAt: Date;
  companyNumber: string | null;
  companyName: string | null;
}[]> {
  return sql`
    SELECT
      e.resource_kind,
      e.resource_id,
      e.published_at,
      -- extract company number from resource_uri
      substring(e.resource_uri FROM '/company/([^/]+)/') AS company_number,
      c.name AS company_name
    FROM audit.events e
    LEFT JOIN public.companies c
      ON c.company_number = substring(e.resource_uri FROM '/company/([^/]+)/')
    WHERE e.published_at IS NOT NULL
    ORDER BY e.published_at DESC
    LIMIT ${limit}
  `;
}

export async function getCompany(companyNumber: string): Promise<Company | null> {
  const rows = await sql<Company[]>`
    SELECT
      company_number,
      name,
      status,
      type,
      incorporated_on,
      dissolved_on,
      registered_address,
      registered_address_postcode,
      registered_address_hash,
      sic_codes,
      last_event_at
    FROM public.companies
    WHERE company_number = ${companyNumber}
  `;
  return rows[0] ?? null;
}

export interface CompanyIdentity {
  companyNumber: string;
  websiteUrl: string | null;
  websiteTitle: string | null;
  websiteDescription: string | null;
  faviconUrl: string | null;
  resolutionMethod: string;
  resolutionConfidence: string;
}

export async function getCompanyIdentity(
  companyNumber: string,
): Promise<CompanyIdentity | null> {
  const rows = await sql<CompanyIdentity[]>`
    SELECT
      company_number,
      website_url,
      website_title,
      website_description,
      favicon_url,
      resolution_method,
      resolution_confidence
    FROM public.company_identity
    WHERE company_number = ${companyNumber}
      AND website_url IS NOT NULL
      AND resolution_confidence IN ('high', 'medium')
  `;
  return rows[0] ?? null;
}

// Phase 4: press mentions (GDELT)
// ──────────────────────────────────────────────────────────────────────

export interface PressMention {
  headline: string;
  url: string;
  sourceDomain: string;
  publishedAt: Date;
  language: string;
}

export async function getCompanyPress(
  companyNumber: string,
  limit = 5,
): Promise<PressMention[]> {
  return sql<PressMention[]>`
    SELECT headline, url, source_domain, published_at, language
    FROM public.company_press
    WHERE company_number = ${companyNumber}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `;
}

export async function getCompanyPressCount(
  companyNumber: string,
): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM public.company_press
    WHERE company_number = ${companyNumber}
  `;
  return rows[0]?.n ?? 0;
}

// Fire-and-forget: bump press search priority on profile view.
export async function bumpPressResolutionPriority(
  companyNumber: string,
): Promise<void> {
  await sql`
    INSERT INTO public.company_press_resolutions
      (company_number, last_searched_at, next_search_at, result_count, consecutive_empties)
    VALUES (${companyNumber}, now(), now(), 0, 0)
    ON CONFLICT (company_number) DO UPDATE SET
      next_search_at = now()
    WHERE public.company_press_resolutions.next_search_at > now()
  `;
}

// Phase 3: filing-pattern badges
// ──────────────────────────────────────────────────────────────────────

export interface CompanyPattern {
  patternKind: string;
  patternLabel: string;
  detail: Record<string, unknown>;
  detectedAt: Date;
}

export async function getCompanyPatterns(
  companyNumber: string,
): Promise<CompanyPattern[]> {
  return sql<CompanyPattern[]>`
    SELECT pattern_kind, pattern_label, detail, detected_at
    FROM public.company_patterns
    WHERE company_number = ${companyNumber}
      AND is_currently_active = true
    ORDER BY detected_at DESC
  `;
}

// Phase 2: director continuity ("Directors also run")
// ──────────────────────────────────────────────────────────────────────
//
// For a given company, find other companies that the same directors are
// also involved with. Matching uses the person_match_key generated column
// (lower(forename) | lower(surname) | dob_year | dob_month) — DoB is the
// disambiguator. Officers without DoB are not matched (we genuinely can't
// tell if it's the same person).
//
// User-reported false positives in meta.match_corrections are excluded.

export interface DirectorContinuityRow {
  viaOfficerId: string;       // the officer of THIS company
  viaName: string;            // their name
  otherOfficerId: string;     // the other officer record (likely same person)
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
}

export async function getDirectorContinuity(
  companyNumber: string,
  limit = 50,
): Promise<DirectorContinuityRow[]> {
  return sql<DirectorContinuityRow[]>`
    WITH this_company_officers AS (
      SELECT DISTINCT
        o.officer_id::text AS officer_id,
        o.name_full,
        o.person_match_key
      FROM public.appointments a
      JOIN public.officers o ON o.officer_id = a.officer_id
      WHERE a.company_number = ${companyNumber}
        AND a.resigned_on IS NULL
        AND o.person_match_key IS NOT NULL
    )
    SELECT
      tco.officer_id   AS via_officer_id,
      tco.name_full    AS via_name,
      o2.officer_id::text AS other_officer_id,
      c.company_number,
      c.name           AS company_name,
      c.status         AS company_status,
      a.role,
      a.appointed_on,
      a.resigned_on
    FROM this_company_officers tco
    JOIN public.officers o2
      ON o2.person_match_key = tco.person_match_key
    JOIN public.appointments a
      ON a.officer_id = o2.officer_id
    JOIN public.companies c
      ON c.company_number = a.company_number
    WHERE c.company_number != ${companyNumber}
      AND NOT EXISTS (
        SELECT 1
        FROM meta.match_corrections mc
        WHERE mc.applied = true
          AND mc.correction_kind = 'not_same_person'
          AND ((mc.officer_id_a::text = tco.officer_id AND mc.officer_id_b = o2.officer_id)
            OR (mc.officer_id_b::text = tco.officer_id AND mc.officer_id_a = o2.officer_id))
      )
    ORDER BY a.resigned_on IS NULL DESC, a.appointed_on DESC NULLS LAST
    LIMIT ${limit}
  `;
}

// For an officer profile: find other officer records (different officer_id)
// that share this person's match key — i.e. likely the same human across
// different appointments-to-different companies (CH issues a fresh officer_id
// per appointment, so we use name+DoB to cluster).
export interface SiblingOfficer {
  officerId: string;
  nameFull: string;
  appointmentCount: number;
}

export async function getSiblingOfficers(
  id: string,
): Promise<SiblingOfficer[]> {
  // id may be either a UUID (officer_id) or a CH slug. Resolve to UUID first.
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const linkPath = `/officers/${id}/appointments`;
  return sql<SiblingOfficer[]>`
    WITH self AS (
      SELECT officer_id, person_match_key
      FROM public.officers
      WHERE ${isUuid ? sql`officer_id = ${id}::uuid` : sql`ch_officer_link = ${linkPath}`}
    )
    SELECT
      o.officer_id::text AS officer_id,
      o.name_full,
      (SELECT COUNT(*) FROM public.appointments a WHERE a.officer_id = o.officer_id)::int AS appointment_count
    FROM public.officers o, self
    WHERE self.person_match_key IS NOT NULL
      AND o.person_match_key = self.person_match_key
      AND o.officer_id != self.officer_id
      AND NOT EXISTS (
        SELECT 1
        FROM meta.match_corrections mc
        WHERE mc.applied = true
          AND mc.correction_kind = 'not_same_person'
          AND (
            (mc.officer_id_a = self.officer_id AND mc.officer_id_b = o.officer_id) OR
            (mc.officer_id_b = self.officer_id AND mc.officer_id_a = o.officer_id)
          )
      )
    ORDER BY appointment_count DESC
    LIMIT 20
  `;
}

// Fire-and-forget: when a profile page is viewed, ensure there's a row in
// company_identity with next_check_at = now() so the resolver picks it up
// at the next cron tick. Safe to call repeatedly — the WHERE clause keeps
// us from clobbering rows that have been recently resolved.
export async function bumpIdentityResolutionPriority(
  companyNumber: string,
): Promise<void> {
  await sql`
    INSERT INTO public.company_identity
      (company_number, resolution_method, resolution_confidence,
       resolved_at, next_check_at, failure_count)
    VALUES (${companyNumber}, 'pending', 'none', now(), now(), 0)
    ON CONFLICT (company_number) DO UPDATE SET
      next_check_at = now()
    WHERE public.company_identity.next_check_at > now()
      AND NOT public.company_identity.override_locked
  `;
}

export async function getCompanyFilings(
  companyNumber: string,
  limit = 50
): Promise<Filing[]> {
  return sql<Filing[]>`
    SELECT
      transaction_id,
      company_number,
      category,
      type,
      description,
      filing_date,
      paper_filed,
      has_pdf,
      ingested_at
    FROM public.filings
    WHERE company_number = ${companyNumber}
    ORDER BY filing_date DESC NULLS LAST
    LIMIT ${limit}
  `;
}

export async function getCompanyOfficers(companyNumber: string): Promise<(Appointment & { officer: Officer })[]> {
  return sql`
    SELECT
      a.company_number,
      a.officer_id,
      a.role,
      a.appointed_on,
      a.resigned_on,
      o.forename,
      o.surname,
      o.name_full,
      o.nationality,
      o.country_of_residence,
      o.occupation,
      o.date_of_birth_year,
      o.date_of_birth_month,
      o.ch_officer_link
    FROM public.appointments a
    JOIN public.officers o USING (officer_id)
    WHERE a.company_number = ${companyNumber}
    ORDER BY a.resigned_on NULLS FIRST, a.appointed_on DESC NULLS LAST
  `;
}

export async function getCompanyPscs(companyNumber: string): Promise<Psc[]> {
  return sql<Psc[]>`
    SELECT
      ch_psc_link,
      company_number,
      kind,
      name,
      is_anonymised,
      natures_of_control,
      notified_on,
      ceased_on,
      nationality,
      country_of_residence
    FROM public.psc
    WHERE company_number = ${companyNumber}
    ORDER BY notified_on DESC NULLS LAST
  `;
}

export async function searchCompanies(query: string, limit = 20): Promise<Company[]> {
  // Search via the name_normalised GIN trigram index — orders of magnitude
  // faster than ILIKE on raw `name` (which has no usable index for leading-
  // wildcard patterns). Each normalised term gets its own ILIKE, AND'd
  // together — supports word-reorder ("isola alessandro" finds "Alessandro
  // Isola Ltd" because both are normalised to "alessandro isola").
  const exactNumber = query.trim().toUpperCase();
  const terms = normaliseSearchTerms(query);

  const trgmConditions = terms.length > 0
    ? terms
        .map((t) => sql`name_normalised ILIKE ${"%" + t + "%"}`)
        .reduce((a, b) => sql`${a} AND ${b}`)
    : sql`FALSE`;

  return sql<Company[]>`
    SELECT
      company_number,
      name,
      status,
      type,
      incorporated_on,
      dissolved_on,
      registered_address,
      registered_address_postcode,
      sic_codes,
      last_event_at
    FROM public.companies
    WHERE
      (${trgmConditions})
      OR company_number = ${exactNumber}
    ORDER BY
      CASE WHEN company_number = ${exactNumber} THEN 0 ELSE 1 END,
      CASE WHEN status = 'active' THEN 0 ELSE 1 END,
      name
    LIMIT ${limit}
  `;
}

export async function searchOfficers(query: string, limit = 20): Promise<(Officer & { appointmentCount: number })[]> {
  // Same trigram-index trick as searchCompanies — but officers.name_normalised
  // stores names surname-first ("smith mark richard"), so per-word AND'd
  // ILIKEs are essential to handle users typing forename-first.
  const terms = normaliseSearchTerms(query);
  if (terms.length === 0) return [];

  const where = terms
    .map((t) => sql`o.name_normalised ILIKE ${"%" + t + "%"}`)
    .reduce((a, b) => sql`${a} AND ${b}`);

  return sql`
    SELECT
      o.officer_id,
      o.forename,
      o.surname,
      o.name_full,
      o.nationality,
      o.country_of_residence,
      o.occupation,
      o.date_of_birth_year,
      o.date_of_birth_month,
      o.ch_officer_link,
      COUNT(a.officer_id)::int AS appointment_count
    FROM public.officers o
    LEFT JOIN public.appointments a USING (officer_id)
    WHERE ${where}
    GROUP BY o.officer_id
    ORDER BY COUNT(a.officer_id) DESC, o.name_full
    LIMIT ${limit}
  `;
}

// Search Companies House REST API for officers — used when local DB returns no results
export async function searchChRestOfficers(query: string): Promise<{
  nameFull: string;
  appointmentCount: number;
  dateOfBirthYear: number | null;
  dateOfBirthMonth: number | null;
  nationality: string | null;
  addressSnippet: string | null;
  chSlug: string | null;
}[]> {
  const r = await chCachedGet(
    `/search/officers?q=${encodeURIComponent(query)}&items_per_page=10`,
    3600, // 1 hour — search index changes daily at most
  );
  if (!r.ok) return [];
  const data = r.data as { items?: Record<string, unknown>[] };
  return (data.items ?? []).map((item) => {
    const dob = (item.date_of_birth as Record<string, number>) ?? {};
    const links = (item.links as Record<string, string>) ?? {};
    const selfLink = links.self ?? "";
    const slugMatch = selfLink.match(/\/officers\/([^/]+)\//);
    return {
      nameFull: (item.title as string) ?? "Unknown",
      appointmentCount: (item.appointment_count as number) ?? 0,
      dateOfBirthYear: dob.year ?? null,
      dateOfBirthMonth: dob.month ?? null,
      nationality: null,
      addressSnippet: (item.address_snippet as string) ?? null,
      chSlug: slugMatch?.[1] ?? null,
    };
  });
}

// Search Companies House REST API directly — used when local DB has no results
export async function searchChRestApi(query: string): Promise<{
  companyNumber: string;
  title: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string | null;
  addressSnippet: string | null;
}[]> {
  const r = await chCachedGet(
    `/search/companies?q=${encodeURIComponent(query)}&items_per_page=10`,
    3600, // 1 hour — search index changes daily at most
  );
  if (!r.ok) return [];
  const data = r.data as { items?: Record<string, unknown>[] };
  try {
    return (data.items ?? []).map((item) => ({
      companyNumber: item.company_number as string,
      title: item.title as string,
      companyStatus: item.company_status as string ?? "unknown",
      companyType: item.company_type as string ?? "unknown",
      dateOfCreation: item.date_of_creation as string ?? null,
      addressSnippet: item.address_snippet as string ?? null,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// On-demand CH REST hydration for company profile pages
// ---------------------------------------------------------------------------

import { chCachedGet } from "./ch-cache";

// Response-shaped envelope so existing callers keep working with `.status`,
// `.ok`, and `.json()`.
interface ChClientResponse {
  status: number;
  ok: boolean;
  // Match the original fetch().json() ergonomics for existing callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>;
}

function envelope(r: { status: number; ok: boolean; data: unknown }): ChClientResponse {
  return {
    status: r.status,
    ok: r.ok,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: async () => r.data as any,
  };
}

function chRestClient() {
  if (!process.env.CH_REST_KEY) return null;
  // Use chCachedGet's 24h default — CH data changes slowly. The streamer
  // separately overwrites our local DB live as new events arrive.
  return (path: string): Promise<ChClientResponse> =>
    chCachedGet(path).then(envelope);
}

export interface ChRestCompany {
  companyNumber: string;
  name: string;
  status: string;
  type: string;
  incorporatedOn: string | null;
  dissolvedOn: string | null;
  registeredAddress: Record<string, string>;
  sicCodes: string[];
  fromRest: true;
}

export interface ChRestOfficer {
  nameFull: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
  nationality: string | null;
  occupation: string | null;
  chOfficerLink: string | null;  // e.g. "/officers/Za4t8N.../appointments"
}

export interface ChRestPsc {
  name: string | null;
  kind: string;
  naturesOfControl: string[];
  notifiedOn: string | null;
  ceasedOn: string | null;
  nationality: string | null;
  isAnonymised: boolean;
}

// Thrown when CH REST returns 429 — distinguishes "rate-limited, try later"
// from "not found". Pages should catch and render a friendly fallback
// instead of a 404.
export class ChRestRateLimitError extends Error {
  constructor() {
    super("Companies House REST API rate-limited");
    this.name = "ChRestRateLimitError";
  }
}

export async function getCompanyFromChRest(companyNumber: string): Promise<ChRestCompany | null> {
  const client = chRestClient();
  if (!client) return null;
  try {
    const res = await client(`/company/${companyNumber}`);
    if (res.status === 429) throw new ChRestRateLimitError();
    if (!res.ok) return null;
    const d = await res.json();
    const addr = d.registered_office_address ?? {};
    return {
      companyNumber: d.company_number,
      name: d.company_name,
      status: d.company_status ?? "unknown",
      type: d.type ?? "unknown",
      incorporatedOn: d.date_of_creation ?? null,
      dissolvedOn: d.date_of_cessation ?? null,
      registeredAddress: addr,
      sicCodes: d.sic_codes ?? [],
      fromRest: true,
    };
  } catch (e) {
    if (e instanceof ChRestRateLimitError) throw e;
    return null;
  }
}

export async function getOfficersFromChRest(companyNumber: string): Promise<ChRestOfficer[]> {
  const client = chRestClient();
  if (!client) return [];
  try {
    const res = await client(`/company/${companyNumber}/officers?items_per_page=50`);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.items ?? []).map((o: Record<string, unknown>) => {
      const links = (o.links as Record<string, unknown>) ?? {};
      const officerLinks = (links.officer as Record<string, unknown>) ?? {};
      const chLink = (officerLinks.appointments as string) ?? null;
      return {
        nameFull: (o.name as string) ?? "",
        role: (o.officer_role as string) ?? "unknown",
        appointedOn: (o.appointed_on as string) ?? null,
        resignedOn: (o.resigned_on as string) ?? null,
        nationality: (o.nationality as string) ?? null,
        occupation: (o.occupation as string) ?? null,
        chOfficerLink: chLink,
      };
    });
  } catch {
    return [];
  }
}

export async function getPscsFromChRest(companyNumber: string): Promise<ChRestPsc[]> {
  const client = chRestClient();
  if (!client) return [];
  try {
    const res = await client(`/company/${companyNumber}/persons-with-significant-control`);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.items ?? []).map((p: Record<string, unknown>) => {
      const kind = (p.kind as string) ?? "unknown";
      const anon = kind.includes("super-secure");
      return {
        name: anon ? null : (p.name as string) ?? null,
        kind,
        naturesOfControl: (p.natures_of_control as string[]) ?? [],
        notifiedOn: (p.notified_on as string) ?? null,
        ceasedOn: (p.ceased_on as string) ?? null,
        nationality: anon ? null : (p.nationality as string) ?? null,
        isAnonymised: anon,
      };
    });
  } catch {
    return [];
  }
}

// Extract the CH slug from a ch_officer_link path
export function chSlugFromLink(link: string): string | null {
  const m = link.match(/\/officers\/([^/]+)\/appointments/);
  return m ? m[1] : null;
}

export interface ChRestAppointment {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface ChRestOfficerProfile {
  nameFull: string;
  nationality: string | null;
  occupation: string | null;
  address: string | null;
  dateOfBirthYear: number | null;
  dateOfBirthMonth: number | null;
  appointments: ChRestAppointment[];
}

export async function getOfficerFromChRest(slug: string): Promise<ChRestOfficerProfile | null> {
  const client = chRestClient();
  if (!client) return null;
  try {
    const res = await client(`/officers/${slug}/appointments?items_per_page=50`);
    if (res.status === 429) throw new ChRestRateLimitError();
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.items?.length) return null;
    const first = d.items[0] as Record<string, unknown>;
    const name = (d.name as string) ?? (first.name as string) ?? "Unknown";
    const dob = (d.date_of_birth as Record<string, number>) ?? {};
    // nationality/occupation may be top-level or per appointment item
    const nationality = (d.nationality as string) ?? (first.nationality as string) ?? null;
    const occupation = (d.occupation as string) ?? (first.occupation as string) ?? null;
    // address: try top-level, then first appointment item
    const rawAddr = (d.address as Record<string, string>) ?? (first.address as Record<string, string>) ?? null;
    const address = rawAddr
      ? [rawAddr.address_line_1, rawAddr.address_line_2, rawAddr.locality, rawAddr.region, rawAddr.postal_code, rawAddr.country]
          .filter(Boolean).join(", ")
      : null;
    return {
      nameFull: name,
      nationality,
      occupation,
      address,
      dateOfBirthYear: dob.year ?? null,
      dateOfBirthMonth: dob.month ?? null,
      appointments: d.items.map((a: Record<string, unknown>) => {
        const appointed = (a.appointed_to as Record<string, unknown>) ?? {};
        return {
          companyNumber: (appointed.company_number as string) ?? "",
          companyName: (appointed.company_name as string) ?? (a.name as string) ?? "",
          companyStatus: (appointed.company_status as string) ?? "unknown",
          role: (a.officer_role as string) ?? "unknown",
          appointedOn: (a.appointed_on as string) ?? null,
          resignedOn: (a.resigned_on as string) ?? null,
        };
      }),
    };
  } catch (e) {
    if (e instanceof ChRestRateLimitError) throw e;
    return null;
  }
}

// Look up officer by UUID OR CH slug
export async function getOfficer(id: string): Promise<Officer | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const rows = await sql<Officer[]>`
    SELECT officer_id, forename, surname, name_full, nationality,
           country_of_residence, occupation, date_of_birth_year, date_of_birth_month,
           ch_officer_link
    FROM public.officers
    WHERE ${isUuid ? sql`officer_id = ${id}::uuid` : sql`ch_officer_link = ${"/officers/" + id + "/appointments"}`}
  `;
  return rows[0] ?? null;
}

export async function getOfficerAppointments(id: string): Promise<(Appointment & { companyName: string; companyStatus: string })[]> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  return sql`
    SELECT
      a.company_number,
      a.officer_id,
      a.role,
      a.appointed_on,
      a.resigned_on,
      c.name AS company_name,
      c.status AS company_status
    FROM public.appointments a
    JOIN public.companies c USING (company_number)
    ${isUuid
      ? sql`WHERE a.officer_id = ${id}::uuid`
      : sql`JOIN public.officers o USING (officer_id) WHERE o.ch_officer_link = ${"/officers/" + id + "/appointments"}`
    }
    ORDER BY a.resigned_on NULLS FIRST, a.appointed_on DESC NULLS LAST
  `;
}

export async function getRecentActivity(limit = 30): Promise<{
  kind: "filing" | "officer" | "psc";
  companyNumber: string;
  companyName: string | null;
  summary: string;
  publishedAt: Date;
}[]> {
  return sql`
    SELECT
      CASE
        WHEN e.resource_kind = 'filing-history'        THEN 'filing'
        WHEN e.resource_kind = 'company-officers'      THEN 'officer'
        WHEN e.resource_kind LIKE 'company-psc%'       THEN 'psc'
        ELSE 'other'
      END AS kind,
      substring(e.resource_uri FROM '/company/([^/]+)/') AS company_number,
      c.name AS company_name,
      e.resource_kind AS summary,
      e.published_at
    FROM audit.events e
    LEFT JOIN public.companies c
      ON c.company_number = substring(e.resource_uri FROM '/company/([^/]+)/')
    WHERE e.published_at IS NOT NULL
      AND e.resource_kind IN ('filing-history', 'company-officers', 'company-psc-individual', 'company-psc-corporate-entity', 'company-psc-legal-person', 'company-psc-super-secure')
    ORDER BY e.published_at DESC
    LIMIT ${limit}
  `;
}

export interface ChRestFiling {
  transactionId: string;
  category: string;
  type: string;
  description: string | null;
  filingDate: string | null;
  paperFiled: boolean;
}

export async function getFilingsFromChRest(companyNumber: string, limit = 50): Promise<ChRestFiling[]> {
  const client = chRestClient();
  if (!client) return [];
  try {
    const res = await client(`/company/${companyNumber}/filing-history?items_per_page=${limit}`);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.items ?? []).map((f: Record<string, unknown>) => ({
      transactionId: f.transaction_id as string,
      category: (f.category as string) ?? "unknown",
      type: (f.type as string) ?? "unknown",
      description: (f.description as string) ?? null,
      filingDate: (f.date as string) ?? null,
      paperFiled: Boolean(f.paper_filed),
    }));
  } catch {
    return [];
  }
}

export async function getRecentFilingEvents(limit = 20): Promise<{
  transactionId: string;
  companyNumber: string;
  companyName: string;
  category: string;
  type: string;
  description: string;
  filingDate: string | null;
  ingestedAt: string;
}[]> {
  const rows = await sql`
    SELECT
      f.transaction_id,
      f.company_number,
      c.name AS company_name,
      f.category,
      f.type,
      f.description,
      f.filing_date,
      f.ingested_at
    FROM public.filings f
    JOIN public.companies c USING (company_number)
    ORDER BY f.ingested_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    transactionId: r.transactionId as string,
    companyNumber: r.companyNumber as string,
    companyName: r.companyName as string,
    category: r.category as string,
    type: r.type as string,
    description: r.description as string,
    filingDate: r.filingDate ? String(r.filingDate) : null,
    ingestedAt: String(r.ingestedAt),
  }));
}

// NavBar status — runs on EVERY page render via layout.tsx, so it's the
// single most-called query in the system. 60s cache means at most one DB
// hit per minute regardless of traffic.
export async function getStatusBar(): Promise<{
  filingsToday: number;
  lastEventAt: Date | null;
  companiesTotal: number;
}> {
  return cachedQuery("stats:statusbar:v1", 60, async () => {
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM public.filings
         WHERE ingested_at >= current_date) AS filings_today,
        (SELECT max(ingested_at) FROM public.filings) AS last_event_at,
        (SELECT count(*)::int FROM public.companies) AS companies_total
    `;
    return rows[0] as { filingsToday: number; lastEventAt: Date | null; companiesTotal: number };
  });
}

// Homepage stats grid — same shape problem, cached for 60s.
export async function getStats(): Promise<{
  companies: number;
  filingsToday: number;
  officers: number;
  pscs: number;
}> {
  return cachedQuery("stats:homepage:v1", 60, async () => {
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM public.companies)  AS companies,
        (SELECT count(*)::int FROM public.filings
         WHERE ingested_at >= current_date)            AS filings_today,
        (SELECT count(*)::int FROM public.officers)   AS officers,
        (SELECT count(*)::int FROM public.psc)        AS pscs
    `;
    return rows[0] as { companies: number; filingsToday: number; officers: number; pscs: number };
  });
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

export interface AnomalyFeatures {
  // address_cluster fields
  address_line_1?: string;
  postcode?: string;
  locality?: string;
  recently_incorporated?: number;
  shared_directors?: number;
  formation_agent?: boolean;
  // director_velocity fields
  officer_id?: string;
  officer_name?: string;
  nationality?: string;
  recent_90_days?: number;
  recent_30_days?: number;
  // officer_churn fields
  company_name?: string;
  company_number?: string;
  status?: string;
  incorporated_on?: string | null;
  appointments_90d?: number;
  terminations_90d?: number;
  total_churn?: number;
  officers?: Array<{
    officer_id: string;
    name: string;
    role: string;
    appointed_on: string | null;
    resigned_on: string | null;
  }>;
  // bulk_registration fields
  address_hash?: string;
  inc_date?: string;
  companies_on_day?: number;
  // common
  company_count: number;
  companies: Array<{
    number: string;
    name: string;
    status: string;
    incorporated_on?: string | null;
    appointed_on?: string | null;
  }>;
}

// postgres.camel camelizes JSONB keys too; this coerces to snake_case regardless
function normalizeFeatures(raw: unknown): AnomalyFeatures {
  const f = raw as Record<string, unknown>;
  const pick = (snake: string, camel: string) => f[snake] ?? f[camel];
  return {
    address_line_1:        pick("address_line_1", "addressLine1") as string | undefined,
    postcode:              f["postcode"] as string | undefined,
    locality:              f["locality"] as string | undefined,
    company_count:         (pick("company_count", "companyCount") as number) ?? 0,
    recently_incorporated: (pick("recently_incorporated", "recentlyIncorporated") as number) ?? undefined,
    shared_directors:      (pick("shared_directors", "sharedDirectors") as number) ?? undefined,
    officer_id:            pick("officer_id", "officerId") as string | undefined,
    officer_name:          pick("officer_name", "officerName") as string | undefined,
    nationality:           f["nationality"] as string | undefined,
    recent_90_days:        (pick("recent_90_days", "recent90Days") as number) ?? undefined,
    recent_30_days:        (pick("recent_30_days", "recent30Days") as number) ?? undefined,
    // officer_churn
    company_name:          pick("company_name", "companyName") as string | undefined,
    company_number:        pick("company_number", "companyNumber") as string | undefined,
    status:                f["status"] as string | undefined,
    incorporated_on:       pick("incorporated_on", "incorporatedOn") as string | null | undefined,
    appointments_90d:      (pick("appointments_90d", "appointments90d") as number) ?? undefined,
    terminations_90d:      (pick("terminations_90d", "terminations90d") as number) ?? undefined,
    total_churn:           (pick("total_churn", "totalChurn") as number) ?? undefined,
    officers:              (f["officers"] as AnomalyFeatures["officers"]) ?? undefined,
    // bulk_registration
    address_hash:          pick("address_hash", "addressHash") as string | undefined,
    inc_date:              pick("inc_date", "incDate") as string | undefined,
    companies_on_day:      (pick("companies_on_day", "companiesOnDay") as number) ?? undefined,
    companies:             (f["companies"] as AnomalyFeatures["companies"]) ?? [],
  };
}

export interface Anomaly {
  id: string;
  kind: string;
  detectionKey: string;
  score: number;
  features: AnomalyFeatures;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  aiSummaryId: string | null;
  aiSummaryOutput: string | null;
  aiSummaryGeneratedAt: Date | null;
}

export async function getAnomalies(limit = 50): Promise<Anomaly[]> {
  const rows = await sql<Anomaly[]>`
    SELECT
      a.id::text                  AS id,
      a.kind,
      a.detection_key,
      a.score,
      a.features,
      a.first_detected_at,
      a.last_detected_at,
      a.ai_summary_id::text       AS ai_summary_id,
      s.output                    AS ai_summary_output,
      s.generated_at              AS ai_summary_generated_at
    FROM public.anomalies a
    LEFT JOIN public.ai_summaries s ON s.id = a.ai_summary_id
    WHERE a.is_currently_flagged = true
      AND a.takedown_action IS DISTINCT FROM 'removed'
    ORDER BY a.score DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...r, features: normalizeFeatures(r.features) }));
}

export async function getAnomaly(id: string): Promise<Anomaly | null> {
  const rows = await sql<Anomaly[]>`
    SELECT
      a.id::text                  AS id,
      a.kind,
      a.detection_key,
      a.score,
      a.features,
      a.first_detected_at,
      a.last_detected_at,
      a.ai_summary_id::text       AS ai_summary_id,
      s.output                    AS ai_summary_output,
      s.generated_at              AS ai_summary_generated_at
    FROM public.anomalies a
    LEFT JOIN public.ai_summaries s ON s.id = a.ai_summary_id
    WHERE a.id = ${id}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, features: normalizeFeatures(row.features) };
}

export async function getCompaniesAtAddress(addressHash: string): Promise<Array<{
  companyNumber: string;
  name: string;
  status: string;
  incorporatedOn: Date | null;
  dissolvedOn: Date | null;
}>> {
  return sql`
    SELECT
      company_number,
      name,
      status,
      incorporated_on,
      dissolved_on
    FROM public.companies
    WHERE registered_address_hash = ${addressHash}
    ORDER BY incorporated_on DESC NULLS LAST
    LIMIT 100
  `;
}

export async function getAnomalyForAddress(addressHash: string): Promise<{ id: string; score: number } | null> {
  const rows = await sql`
    SELECT id::text, score
    FROM public.anomalies
    WHERE detection_key = ${addressHash}
      AND is_currently_flagged = true
      AND takedown_action IS DISTINCT FROM 'removed'
    LIMIT 1
  `;
  return (rows[0] as { id: string; score: number } | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Cheap "is there anything matching this query" counts. Uses the
// name_normalised GIN trigram index on both tables — popular queries that
// would otherwise full-table-scan now hit the index. LIMIT-N caps further so
// extremely common terms ("smith") return fast; callers show the cap as "N+".
// ---------------------------------------------------------------------------

import { normaliseSearchTerms } from "./utils";

export async function getSearchCounts(
  query: string,
  cap: number,
): Promise<{ companiesN: number; officersN: number }> {
  const terms = normaliseSearchTerms(query);
  if (terms.length === 0) return { companiesN: 0, officersN: 0 };

  const where = terms
    .map((t) => sql`name_normalised ILIKE ${"%" + t + "%"}`)
    .reduce((a, b) => sql`${a} AND ${b}`);

  const rows = await sql<{ companiesN: number; officersN: number }[]>`
    SELECT
      (SELECT count(*)::int FROM (
        SELECT 1 FROM public.companies WHERE ${where} LIMIT ${cap}
      ) c) AS companies_n,
      (SELECT count(*)::int FROM (
        SELECT 1 FROM public.officers  WHERE ${where} LIMIT ${cap}
      ) o) AS officers_n
  `;
  return rows[0] ?? { companiesN: 0, officersN: 0 };
}

// ---------------------------------------------------------------------------
// Search analytics — fire-and-forget. Silently drops errors so a logging
// failure can never break the page render.
// ---------------------------------------------------------------------------

export type SearchQueryType =
  | "company_name"
  | "company_number"
  | "postcode"
  | "officer_name";

export async function logSearch(
  query: string,
  queryType: SearchQueryType,
  resultCountLocal: number,
  resultCountRemote: number,
  ipHash: string | null,
): Promise<void> {
  await sql`
    INSERT INTO audit.searches
      (query, query_type, result_count_local, result_count_remote, had_results, ip_hash)
    VALUES (
      ${query},
      ${queryType},
      ${resultCountLocal},
      ${resultCountRemote},
      ${resultCountLocal + resultCountRemote > 0},
      ${ipHash}
    )
  `;
}

export async function getSharedDirectors(addressHash: string): Promise<Array<{
  officerId: string;
  nameFull: string;
  nationality: string | null;
  companyCount: number;
}>> {
  return sql`
    SELECT
      o.officer_id::text  AS officer_id,
      o.name_full,
      o.nationality,
      COUNT(DISTINCT a.company_number)::int AS company_count
    FROM public.appointments a
    JOIN public.officers o ON o.officer_id = a.officer_id
    JOIN public.companies c ON c.company_number = a.company_number
    WHERE c.registered_address_hash = ${addressHash}
      AND a.resigned_on IS NULL
    GROUP BY o.officer_id, o.name_full, o.nationality
    HAVING COUNT(DISTINCT a.company_number) >= 2
    ORDER BY company_count DESC
    LIMIT 20
  `;
}
