"""
Address normaliser for anomaly detection clustering.

Two addresses that refer to the same physical location must produce the same
hash. The algorithm is deliberately simple (v1). Sophistication is v2 work.
See DATA_MODEL.md §10 for the full specification.
"""
import hashlib
import re
import unicodedata

# Common UK street abbreviations → full form
_ABBREVS: dict[str, str] = {
    "ave": "avenue",
    "av": "avenue",
    "rd": "road",
    "st": "street",
    "ln": "lane",
    "cl": "close",
    "ct": "court",
    "dr": "drive",
    "pl": "place",
    "sq": "square",
    "blvd": "boulevard",
    "cres": "crescent",
    "gdns": "gardens",
    "grn": "green",
    "gro": "grove",
    "hse": "house",
    "mws": "mews",
    "pk": "park",
    "pde": "parade",
    "pas": "passage",
    "ter": "terrace",
    "tce": "terrace",
    "wk": "walk",
    "wy": "way",
    "bvd": "boulevard",
    "hl": "hill",
    "vw": "view",
    "bldg": "building",
    "bldgs": "buildings",
    "flt": "flat",
    "flts": "flats",
    "apt": "apartment",
    "apts": "apartments",
    "hts": "heights",
    "est": "estate",
    "ind": "industrial",
    "bus": "business",
    "pk": "park",
    "ctr": "centre",
    "cntr": "centre",
}

_TRAILING_NOISE = re.compile(
    r"\b(united kingdom|england|scotland|wales|northern ireland|uk|gb)\s*$",
    re.IGNORECASE,
)

# Matches standard UK postcodes (with or without the space)
_POSTCODE_RE = re.compile(
    r"\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b",
    re.IGNORECASE,
)

# Digits embedded in address line that indicate a flat/unit qualifier
_FLAT_NUMBER_RE = re.compile(r"(?:flat|unit|apartment|apt|room|flt)\s+(\w+)", re.IGNORECASE)


def _normalise_postcode(raw: str) -> str:
    """Normalise to 'SW1A 1AA' form (uppercase, single space before incode)."""
    pc = raw.upper().replace(" ", "").replace("\t", "")
    if len(pc) < 5:
        return pc
    return f"{pc[:-3]} {pc[-3:]}"


def _expand_abbreviations(text: str) -> str:
    return " ".join(_ABBREVS.get(w, w) for w in text.split())


def _ascii_fold(text: str) -> str:
    """Decompose unicode and drop non-ASCII characters."""
    return (
        unicodedata.normalize("NFKD", text)
        .encode("ascii", "ignore")
        .decode()
    )


def normalise_address(addr: dict) -> tuple[str, str]:
    """
    Return (hash, human_readable_normalised) for an address dict.

    The hash is SHA1 of "{normalised_first_line}|{postcode}".
    Addresses without a usable postcode return "nopostcode:{hash}" and are
    excluded from anomaly detection in v1.

    Args:
        addr: dict with keys: address_line_1, address_line_2, locality,
              region, postal_code, country (all optional).

    Returns:
        (hash_str, human_readable)
    """
    line1 = (addr.get("address_line_1") or "").strip()
    postcode_raw = (addr.get("postal_code") or "").strip()

    # If no explicit postal_code, try to extract from other fields
    if not postcode_raw:
        combined = " ".join(
            v
            for v in [
                addr.get("address_line_1"),
                addr.get("address_line_2"),
                addr.get("locality"),
                addr.get("region"),
            ]
            if v
        )
        m = _POSTCODE_RE.search(combined)
        postcode_raw = m.group(1) if m else ""

    if not postcode_raw:
        # Can't reliably cluster without a postcode
        fallback = _ascii_fold(line1.lower())
        h = hashlib.sha1(fallback.encode()).hexdigest()
        return f"nopostcode:{h}", line1

    postcode = _normalise_postcode(postcode_raw)

    # Normalise first line
    normalised = line1.lower()
    normalised = _ascii_fold(normalised)
    normalised = _TRAILING_NOISE.sub("", normalised)
    # Strip punctuation except alphanumerics and spaces
    normalised = re.sub(r"[^\w\s]", " ", normalised)
    # Expand abbreviations word-by-word
    normalised = _expand_abbreviations(normalised)
    # Collapse whitespace
    normalised = re.sub(r"\s+", " ", normalised).strip()

    human = f"{normalised}, {postcode}"
    digest = hashlib.sha1(f"{normalised}|{postcode}".encode()).hexdigest()
    return digest, human
