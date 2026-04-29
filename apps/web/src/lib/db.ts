import postgres from "postgres";

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
      sic_codes,
      last_event_at
    FROM public.companies
    WHERE company_number = ${companyNumber}
  `;
  return rows[0] ?? null;
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
      o.date_of_birth_month
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
  // Use pg_trgm similarity + tsquery for combined search
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
      name ILIKE ${"%" + query + "%"}
      OR company_number = ${query.trim().toUpperCase()}
    ORDER BY
      CASE WHEN company_number = ${query.trim().toUpperCase()} THEN 0 ELSE 1 END,
      CASE WHEN status = 'active' THEN 0 ELSE 1 END,
      name
    LIMIT ${limit}
  `;
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
  const key = process.env.CH_REST_KEY;
  if (!key) return [];

  const token = Buffer.from(`${key}:`).toString("base64");
  try {
    const res = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=10`,
      {
        headers: { Authorization: `Basic ${token}` },
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((item: Record<string, unknown>) => ({
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

export async function getStats(): Promise<{
  companies: number;
  filings: number;
  officers: number;
  pscs: number;
}> {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM public.companies)  AS companies,
      (SELECT count(*)::int FROM public.filings)    AS filings,
      (SELECT count(*)::int FROM public.officers)   AS officers,
      (SELECT count(*)::int FROM public.psc)        AS pscs
  `;
  return rows[0] as { companies: number; filings: number; officers: number; pscs: number };
}
