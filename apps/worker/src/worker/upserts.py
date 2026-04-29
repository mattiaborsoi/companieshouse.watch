"""
Database upsert functions for each entity type.
Each function is idempotent — safe to call multiple times with the same data.
"""
import json
import re

import asyncpg
import structlog

from .normaliser import normalise_address

log = structlog.get_logger()


# ---------------------------------------------------------------------------
# Name normalisation
# ---------------------------------------------------------------------------

_NAME_SUFFIXES = re.compile(
    r"\b(limited|ltd\.?|public limited company|plc\.?|llp\.?|llc\.?|l\.l\.p\.?|"
    r"l\.t\.d\.?|cic|charitable incorporated organisation|cio)\b",
    re.IGNORECASE,
)


def _normalise_name(name: str) -> str:
    n = name.lower()
    n = _NAME_SUFFIXES.sub("", n)
    n = re.sub(r"[^\w\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


# ---------------------------------------------------------------------------
# Company
# ---------------------------------------------------------------------------

async def upsert_company(conn: asyncpg.Connection, data: dict) -> None:
    addr = data.get("registered_office_address") or {}
    addr_hash, _ = normalise_address(addr)
    postcode = (addr.get("postal_code") or "").lower().replace(" ", "") or None

    name = data.get("company_name") or ""
    sic_codes = data.get("sic_codes") or []

    # Extract nested dates safely
    accounts = data.get("accounts") or {}
    cs = data.get("confirmation_statement") or {}

    await conn.execute(
        """
        INSERT INTO public.companies (
            company_number, name, name_normalised, status, status_detail,
            type, jurisdiction,
            incorporated_on, dissolved_on,
            registered_address, registered_address_postcode, registered_address_hash,
            sic_codes,
            has_charges, has_insolvency, has_been_liquidated,
            accounts_next_due, accounts_last_made_up_to, confirmation_next_due,
            raw, raw_etag,
            last_full_refresh_at, last_event_at
        ) VALUES (
            $1,  $2,  $3,  $4,  $5,
            $6,  $7,
            $8::date,  $9::date,
            $10::jsonb,  $11,  $12,
            $13::text[],
            $14,  $15,  $16,
            $17::date,  $18::date,  $19::date,
            $20::jsonb,  $21,
            now(),  now()
        )
        ON CONFLICT (company_number) DO UPDATE SET
            name                          = EXCLUDED.name,
            name_normalised               = EXCLUDED.name_normalised,
            status                        = EXCLUDED.status,
            status_detail                 = EXCLUDED.status_detail,
            type                          = EXCLUDED.type,
            jurisdiction                  = EXCLUDED.jurisdiction,
            incorporated_on               = EXCLUDED.incorporated_on,
            dissolved_on                  = EXCLUDED.dissolved_on,
            registered_address            = EXCLUDED.registered_address,
            registered_address_postcode   = EXCLUDED.registered_address_postcode,
            registered_address_hash       = EXCLUDED.registered_address_hash,
            sic_codes                     = EXCLUDED.sic_codes,
            has_charges                   = EXCLUDED.has_charges,
            has_insolvency                = EXCLUDED.has_insolvency,
            has_been_liquidated           = EXCLUDED.has_been_liquidated,
            accounts_next_due             = EXCLUDED.accounts_next_due,
            accounts_last_made_up_to      = EXCLUDED.accounts_last_made_up_to,
            confirmation_next_due         = EXCLUDED.confirmation_next_due,
            raw                           = EXCLUDED.raw,
            raw_etag                      = EXCLUDED.raw_etag,
            last_full_refresh_at          = now(),
            last_event_at                 = now()
        """,
        data.get("company_number"),
        name,
        _normalise_name(name),
        data.get("company_status") or "unknown",
        data.get("company_status_detail"),
        data.get("type") or "unknown",
        data.get("jurisdiction") or "england-wales",
        data.get("date_of_creation"),
        data.get("date_of_cessation"),
        json.dumps(addr),
        postcode,
        addr_hash,
        sic_codes,
        bool(data.get("has_charges")),
        bool(data.get("has_insolvency_history")),
        bool(data.get("has_been_liquidated")),
        accounts.get("next_due"),
        (accounts.get("last_accounts") or {}).get("made_up_to"),
        cs.get("next_due"),
        json.dumps(data),
        data.get("etag"),
    )


# ---------------------------------------------------------------------------
# Filing
# ---------------------------------------------------------------------------

async def upsert_filing(conn: asyncpg.Connection, data: dict) -> None:
    transaction_id = data.get("transaction_id")
    company_number = data.get("company_number")

    if not transaction_id or not company_number:
        log.warning("filing_missing_ids", data=str(data)[:200])
        return

    links = data.get("links") or {}

    await conn.execute(
        """
        INSERT INTO public.filings (
            transaction_id, company_number,
            category, type, subcategory,
            description, description_values,
            filing_date, action_date,
            paper_filed, pages,
            document_metadata_url, has_pdf,
            raw, ingested_at
        ) VALUES (
            $1,  $2,
            $3,  $4,  $5,
            $6,  $7::jsonb,
            $8::date,  $9::date,
            $10,  $11,
            $12,  $13,
            $14::jsonb,  now()
        )
        ON CONFLICT (transaction_id) DO UPDATE SET
            description         = EXCLUDED.description,
            description_values  = EXCLUDED.description_values,
            paper_filed         = EXCLUDED.paper_filed,
            has_pdf             = EXCLUDED.has_pdf,
            raw                 = EXCLUDED.raw
        """,
        transaction_id,
        company_number,
        data.get("category") or "unknown",
        data.get("type") or "unknown",
        data.get("subcategory"),
        data.get("description") or "",
        json.dumps(data.get("description_values") or {}),
        data.get("date"),
        data.get("action_date"),
        bool(data.get("paper_filed")),
        data.get("pages"),
        links.get("document_metadata"),
        bool(links.get("document_metadata")),
        json.dumps(data),
    )


# ---------------------------------------------------------------------------
# Officer + Appointment
# ---------------------------------------------------------------------------

async def upsert_officer_appointment(conn: asyncpg.Connection, data: dict) -> None:
    """
    Each CH officer event is an appointment record. In v1 we do not do entity
    resolution — one officer record per ch_officer_link.
    """
    links = data.get("links") or {}
    officer_link = links.get("officer", {}).get("appointments") or links.get("self")

    if not officer_link:
        log.warning("officer_missing_link", data=str(data)[:200])
        return

    company_number = data.get("company_number") or (
        # Sometimes embedded in the appointed_to field
        (data.get("appointed_to") or {}).get("company_number")
    )
    if not company_number:
        log.warning("officer_missing_company", data=str(data)[:200])
        return

    name_full = data.get("name") or ""
    name_parts = name_full.split(",", 1)
    surname = name_parts[0].strip() if name_parts else name_full
    forename = name_parts[1].strip() if len(name_parts) > 1 else None

    dob = data.get("date_of_birth") or {}
    dob_year = dob.get("year")
    dob_month = dob.get("month")

    # Upsert the officer record
    officer_id: str = await conn.fetchval(
        """
        INSERT INTO public.officers (
            ch_officer_link,
            forename, surname, name_full, name_normalised,
            date_of_birth_year, date_of_birth_month,
            nationality, country_of_residence, occupation,
            raw, last_event_at
        ) VALUES (
            $1,
            $2,  $3,  $4,  $5,
            $6,  $7,
            $8,  $9,  $10,
            $11::jsonb,  now()
        )
        ON CONFLICT (ch_officer_link) DO UPDATE SET
            forename                = EXCLUDED.forename,
            surname                 = EXCLUDED.surname,
            name_full               = EXCLUDED.name_full,
            name_normalised         = EXCLUDED.name_normalised,
            nationality             = EXCLUDED.nationality,
            country_of_residence    = EXCLUDED.country_of_residence,
            occupation              = EXCLUDED.occupation,
            raw                     = EXCLUDED.raw,
            last_event_at           = now()
        RETURNING officer_id
        """,
        officer_link,
        forename,
        surname,
        name_full,
        _normalise_name(name_full),
        dob_year,
        dob_month,
        data.get("nationality"),
        data.get("country_of_residence"),
        data.get("occupation"),
        json.dumps(data),
    )

    if not officer_id:
        # Row already existed and ON CONFLICT ... RETURNING may return nothing
        officer_id = await conn.fetchval(
            "SELECT officer_id FROM public.officers WHERE ch_officer_link = $1",
            officer_link,
        )

    role = data.get("officer_role") or data.get("role") or "unknown"
    appointed_on = data.get("appointed_on")
    resigned_on = data.get("resigned_on")

    await conn.execute(
        """
        INSERT INTO public.appointments (
            company_number, officer_id,
            role, appointed_on, resigned_on,
            is_pre_1992, appointed_address,
            raw, last_event_at
        ) VALUES (
            $1,  $2,
            $3,  $4::date,  $5::date,
            $6,  $7::jsonb,
            $8::jsonb,  now()
        )
        ON CONFLICT (company_number, officer_id, role, appointed_on) DO UPDATE SET
            resigned_on         = EXCLUDED.resigned_on,
            appointed_address   = EXCLUDED.appointed_address,
            raw                 = EXCLUDED.raw,
            last_event_at       = now()
        """,
        company_number,
        officer_id,
        role,
        appointed_on,
        resigned_on,
        not bool(appointed_on),
        json.dumps(data.get("address") or {}),
        json.dumps(data),
    )


# ---------------------------------------------------------------------------
# PSC
# ---------------------------------------------------------------------------

async def upsert_psc(conn: asyncpg.Connection, data: dict) -> None:
    ch_psc_link = (data.get("links") or {}).get("self")
    company_number = data.get("company_number")

    if not ch_psc_link or not company_number:
        log.warning("psc_missing_ids", data=str(data)[:200])
        return

    kind = data.get("kind") or "unknown"
    is_anonymised = "super-secure" in kind

    name = None if is_anonymised else data.get("name")
    name_elements = None if is_anonymised else data.get("name_elements")

    dob = data.get("date_of_birth") or {}

    await conn.execute(
        """
        INSERT INTO public.psc (
            ch_psc_link, company_number, kind,
            name, name_elements, is_anonymised,
            natures_of_control,
            notified_on, ceased_on,
            date_of_birth_year, date_of_birth_month,
            nationality, country_of_residence,
            identification,
            raw, last_event_at
        ) VALUES (
            $1,  $2,  $3,
            $4,  $5::jsonb,  $6,
            $7::text[],
            $8::date,  $9::date,
            $10,  $11,
            $12,  $13,
            $14::jsonb,
            $15::jsonb,  now()
        )
        ON CONFLICT (ch_psc_link) DO UPDATE SET
            kind                    = EXCLUDED.kind,
            name                    = EXCLUDED.name,
            name_elements           = EXCLUDED.name_elements,
            is_anonymised           = EXCLUDED.is_anonymised,
            natures_of_control      = EXCLUDED.natures_of_control,
            notified_on             = EXCLUDED.notified_on,
            ceased_on               = EXCLUDED.ceased_on,
            nationality             = EXCLUDED.nationality,
            country_of_residence    = EXCLUDED.country_of_residence,
            identification          = EXCLUDED.identification,
            raw                     = EXCLUDED.raw,
            last_event_at           = now()
        """,
        ch_psc_link,
        company_number,
        kind,
        name,
        json.dumps(name_elements) if name_elements else None,
        is_anonymised,
        data.get("natures_of_control") or [],
        data.get("notified_on"),
        data.get("ceased_on"),
        None if is_anonymised else dob.get("year"),
        None if is_anonymised else dob.get("month"),
        None if is_anonymised else data.get("nationality"),
        None if is_anonymised else data.get("country_of_residence"),
        json.dumps(data.get("identification")) if data.get("identification") else None,
        json.dumps(data),
    )
