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

export async function searchOfficers(query: string, limit = 20): Promise<(Officer & { appointmentCount: number })[]> {
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
      COUNT(a.officer_id)::int AS appointment_count
    FROM public.officers o
    LEFT JOIN public.appointments a USING (officer_id)
    WHERE o.name_full ILIKE ${"%" + query + "%"}
    GROUP BY o.officer_id
    ORDER BY COUNT(a.officer_id) DESC, o.name_full
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

// ---------------------------------------------------------------------------
// On-demand CH REST hydration for company profile pages
// ---------------------------------------------------------------------------

function chRestClient() {
  const key = process.env.CH_REST_KEY;
  if (!key) return null;
  const token = Buffer.from(`${key}:`).toString("base64");
  return (path: string) =>
    fetch(`https://api.company-information.service.gov.uk${path}`, {
      headers: { Authorization: `Basic ${token}` },
      next: { revalidate: 300 },
    });
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

export async function getCompanyFromChRest(companyNumber: string): Promise<ChRestCompany | null> {
  const client = chRestClient();
  if (!client) return null;
  try {
    const res = await client(`/company/${companyNumber}`);
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
  } catch {
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
    return (d.items ?? []).map((o: Record<string, unknown>) => ({
      nameFull: o.name as string ?? "",
      role: o.officer_role as string ?? "unknown",
      appointedOn: o.appointed_on as string ?? null,
      resignedOn: o.resigned_on as string ?? null,
      nationality: (o.nationality as string) ?? null,
      occupation: (o.occupation as string) ?? null,
    }));
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

export async function getOfficer(officerId: string): Promise<Officer | null> {
  const rows = await sql<Officer[]>`
    SELECT officer_id, forename, surname, name_full, nationality,
           country_of_residence, occupation, date_of_birth_year, date_of_birth_month
    FROM public.officers
    WHERE officer_id = ${officerId}
  `;
  return rows[0] ?? null;
}

export async function getOfficerAppointments(officerId: string): Promise<(Appointment & { companyName: string; companyStatus: string })[]> {
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
    WHERE a.officer_id = ${officerId}
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
