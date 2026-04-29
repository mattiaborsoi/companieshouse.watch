"""
Test suite for the address normaliser.

Structure:
  - EQUIVALENT_PAIRS: 50+ pairs that must produce the same hash.
  - NON_COLLIDING: 20+ pairs that must NOT produce the same hash.
  - Edge-case tests for postcodes, missing fields, Unicode, etc.
"""
import pytest

from worker.normaliser import normalise_address, _normalise_postcode


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def h(addr_dict: dict) -> str:
    """Return just the hash for an address dict."""
    return normalise_address(addr_dict)[0]


def addr(line1: str, postcode: str) -> dict:
    return {"address_line_1": line1, "postal_code": postcode}


# ---------------------------------------------------------------------------
# Postcode normalisation
# ---------------------------------------------------------------------------

class TestNormalisePostcode:
    def test_adds_space(self):
        assert _normalise_postcode("SW1A1AA") == "SW1A 1AA"

    def test_preserves_space(self):
        assert _normalise_postcode("SW1A 1AA") == "SW1A 1AA"

    def test_handles_extra_space(self):
        assert _normalise_postcode("SW1A  1AA") == "SW1A 1AA"

    def test_lowercased_input(self):
        assert _normalise_postcode("sw1a1aa") == "SW1A 1AA"

    def test_short_postcode(self):
        assert _normalise_postcode("N11AA") == "N1 1AA"

    def test_district_postcode(self):
        assert _normalise_postcode("EC1A1BB") == "EC1A 1BB"


# ---------------------------------------------------------------------------
# Equivalent pairs (must hash to the same value)
# ---------------------------------------------------------------------------

EQUIVALENT_PAIRS = [
    # 1-2: capitalisation
    (addr("12 Acacia Avenue", "N1 7AB"), addr("12 acacia avenue", "N1 7AB")),
    (addr("FLAT 1 HIGH STREET", "SW1A 1AA"), addr("flat 1 high street", "SW1A 1AA")),

    # 3-4: postcode spacing
    (addr("1 Baker Street", "NW16XE"), addr("1 Baker Street", "NW1 6XE")),
    (addr("2 Church Road", "E1 7PT"), addr("2 Church Road", "E17PT")),

    # 5-6: abbreviation expansion
    (addr("10 High Rd", "M1 1AA"), addr("10 High Road", "M1 1AA")),
    (addr("5 Oak Ave", "B1 1AA"), addr("5 Oak Avenue", "B1 1AA")),

    # 7-8: more abbreviations
    (addr("3 Elm St", "LS1 1AA"), addr("3 Elm Street", "LS1 1AA")),
    (addr("7 Rose Ln", "BS1 1AA"), addr("7 Rose Lane", "BS1 1AA")),

    # 9-10: punctuation stripping
    (addr("Unit 4, Business Park", "OX1 1AA"), addr("Unit 4 Business Park", "OX1 1AA")),
    (addr("1st Floor, High Street", "W1A 1AA"), addr("1st Floor High Street", "W1A 1AA")),

    # 11-12: trailing country stripping
    (addr("10 Mill Road, United Kingdom", "CB1 1AA"), addr("10 Mill Road", "CB1 1AA")),
    (addr("5 High St, England", "YO1 1AA"), addr("5 High St", "YO1 1AA")),

    # 13-14: trailing 'scotland' and 'wales'
    (addr("1 Castle Row, Scotland", "EH1 1AA"), addr("1 Castle Row", "EH1 1AA")),
    (addr("2 Dragon Lane, Wales", "CF1 1AA"), addr("2 Dragon Lane", "CF1 1AA")),

    # 15-16: extra whitespace
    (addr("12   Acacia   Avenue", "N1 7AB"), addr("12 Acacia Avenue", "N1 7AB")),
    (addr("  5 Park Lane  ", "W1K 1AA"), addr("5 Park Lane", "W1K 1AA")),

    # 17-18: mixed abbreviation + capitalisation
    (addr("Flat 3 Oak Ave", "M1 1AA"), addr("flat 3 oak avenue", "M1 1AA")),
    (addr("4 Elm RD", "LS1 1AA"), addr("4 elm road", "LS1 1AA")),

    # 19-20: hyphenated address treated same as spaced
    (addr("10-12 High Street", "EC1A 1AA"), addr("10 12 High Street", "EC1A 1AA")),
    (addr("Unit 4-5, Park", "OX1 1AA"), addr("Unit 4 5 Park", "OX1 1AA")),

    # 21-22: 'Northern Ireland' stripped
    (addr("3 Bridge St, Northern Ireland", "BT1 1AA"), addr("3 Bridge St", "BT1 1AA")),
    (addr("1 High Rd, UK", "BT1 1AA"), addr("1 High Road", "BT1 1AA")),

    # 23-24: Cl → close, Ct → court
    (addr("7 Manor Cl", "RG1 1AA"), addr("7 Manor Close", "RG1 1AA")),
    (addr("2 Crown Ct", "WC2N 1AA"), addr("2 Crown Court", "WC2N 1AA")),

    # 25-26: Cres → crescent, Ter → terrace
    (addr("9 Park Cres", "W1B 1AA"), addr("9 Park Crescent", "W1B 1AA")),
    (addr("6 Lime Ter", "N1 1AA"), addr("6 Lime Terrace", "N1 1AA")),

    # 27-28: Gdns → gardens, Mws → mews
    (addr("12 Rose Gdns", "SW6 1AA"), addr("12 Rose Gardens", "SW6 1AA")),
    (addr("3 Cobble Mws", "W1J 1AA"), addr("3 Cobble Mews", "W1J 1AA")),

    # 29-30: unicode accents fold to ASCII
    (addr("1 Café Row", "EC1A 1AA"), addr("1 Cafe Row", "EC1A 1AA")),
    (addr("2 Naïve Street", "N1 1AA"), addr("2 Naive Street", "N1 1AA")),

    # 31-32: mixed case postcode
    (addr("1 Kings Road", "sw3 4rn"), addr("1 Kings Road", "SW3 4RN")),
    (addr("2 Queens Ave", "W1j1aa"), addr("2 Queens Avenue", "W1J 1AA")),

    # 33-34: Pk → park, Dr → drive
    (addr("5 Business Pk", "OX1 1AA"), addr("5 Business Park", "OX1 1AA")),
    (addr("11 Oak Dr", "PE1 1AA"), addr("11 Oak Drive", "PE1 1AA")),

    # 35-36: Pl → place, Sq → square
    (addr("3 Victoria Pl", "SW1E 1AA"), addr("3 Victoria Place", "SW1E 1AA")),
    (addr("7 Red Lion Sq", "WC1R 1AA"), addr("7 Red Lion Square", "WC1R 1AA")),

    # 37-38: number formats
    (addr("Flat 10 High Street", "E1 7PT"), addr("flat 10 high street", "E17PT")),
    (addr("14a Church Lane", "NG1 1AA"), addr("14a Church Lane", "NG1 1AA")),

    # 39-40: multiple abbreviations in one line
    (addr("Unit 3 Ind Est Park Rd", "LS1 1AA"), addr("Unit 3 Industrial Estate Park Road", "LS1 1AA")),
    (addr("1 Bus Ctr Oak Ave", "M1 1AA"), addr("1 Business Centre Oak Avenue", "M1 1AA")),

    # 41-42: Grn → green, Gro → grove
    (addr("8 Elm Grn", "RH1 1AA"), addr("8 Elm Green", "RH1 1AA")),
    (addr("4 Cedar Gro", "HA1 1AA"), addr("4 Cedar Grove", "HA1 1AA")),

    # 43-44: Hse → house, Blvd → boulevard
    (addr("Tudor Hse High St", "OX1 1AA"), addr("Tudor House High Street", "OX1 1AA")),
    (addr("1 Victoria Blvd", "L1 1AA"), addr("1 Victoria Boulevard", "L1 1AA")),

    # 45-46: Pde → parade, Wk → walk
    (addr("5 High Pde", "CR0 1AA"), addr("5 High Parade", "CR0 1AA")),
    (addr("2 Riverside Wk", "SE1 1AA"), addr("2 Riverside Walk", "SE1 1AA")),

    # 47-48: postcode extracted from address_line_2
    (
        {"address_line_1": "10 High Street", "address_line_2": "London N1 7AB"},
        addr("10 High Street", "N1 7AB"),
    ),
    (
        {"address_line_1": "5 Park Lane", "locality": "London W1K 1AA"},
        addr("5 Park Lane", "W1K 1AA"),
    ),

    # 49-50: Wy → way, Tce → terrace
    (addr("1 Riverside Wy", "BS1 1AA"), addr("1 Riverside Way", "BS1 1AA")),
    (addr("3 Ocean Tce", "BN1 1AA"), addr("3 Ocean Terrace", "BN1 1AA")),

    # 51: tabs and newlines collapse
    (
        {"address_line_1": "1\tHigh\nStreet", "postal_code": "EC1A 1AA"},
        addr("1 High Street", "EC1A 1AA"),
    ),

    # 52: Flt → flat
    (addr("Flt 2 High Street", "N1 1AA"), addr("Flat 2 High Street", "N1 1AA")),
]


@pytest.mark.parametrize("a, b", EQUIVALENT_PAIRS)
def test_equivalent(a, b):
    ha, _ = normalise_address(a)
    hb, _ = normalise_address(b)
    assert ha == hb, f"Expected same hash:\n  {a}\n  {b}\n  got {ha!r} vs {hb!r}"


# ---------------------------------------------------------------------------
# Non-colliding pairs (must NOT hash to the same value)
# ---------------------------------------------------------------------------

NON_COLLIDING_PAIRS = [
    # 1: different street numbers
    (addr("1 High Street", "N1 7AB"), addr("2 High Street", "N1 7AB")),

    # 2: different streets same postcode
    (addr("1 Church Road", "N1 7AB"), addr("1 High Street", "N1 7AB")),

    # 3: different postcodes same line
    (addr("10 Mill Road", "CB1 1AA"), addr("10 Mill Road", "CB2 1AA")),

    # 4: flat vs no flat qualifier
    (addr("1 Oak Avenue", "M1 1AA"), addr("Flat 1 Oak Avenue", "M1 1AA")),

    # 5: different flat numbers
    (addr("Flat 1 Oak Avenue", "M1 1AA"), addr("Flat 2 Oak Avenue", "M1 1AA")),

    # 6: adjacent postcodes
    (addr("1 High Street", "EC1A 1AA"), addr("1 High Street", "EC1A 2AA")),

    # 7: similar but different streets
    (addr("1 Park Road", "W1J 1AA"), addr("1 Park Lane", "W1J 1AA")),

    # 8: different unit numbers
    (addr("Unit 1 Business Park", "OX1 1AA"), addr("Unit 2 Business Park", "OX1 1AA")),

    # 9: house name vs number
    (addr("Rose Cottage", "RG1 1AA"), addr("1 Rose Road", "RG1 1AA")),

    # 10: different building names
    (addr("Acorn House High Street", "EC1A 1AA"), addr("Oak House High Street", "EC1A 1AA")),

    # 11: Scotland postcode vs England
    (addr("1 High Street", "EH1 1AA"), addr("1 High Street", "EC1A 1AA")),

    # 12: completely different addresses
    (addr("10 Downing Street", "SW1A 2AA"), addr("Buckingham Palace", "SW1A 1AA")),

    # 13: floor qualifier matters
    (addr("1st Floor 10 High Street", "EC1A 1AA"), addr("2nd Floor 10 High Street", "EC1A 1AA")),

    # 14: letter suffix on house number
    (addr("14a Church Lane", "NG1 1AA"), addr("14b Church Lane", "NG1 1AA")),

    # 15: nopostcode addresses with different lines
    (
        {"address_line_1": "The Old Barn", "address_line_2": "Somewhere Remote"},
        {"address_line_1": "The New Barn", "address_line_2": "Somewhere Remote"},
    ),

    # 16: adjacent numbers
    (addr("99 Victoria Road", "SW1 1AA"), addr("100 Victoria Road", "SW1 1AA")),

    # 17: road vs avenue
    (addr("5 Oak Road", "M1 1AA"), addr("5 Oak Avenue", "M1 1AA")),

    # 18: different towns, same street name + postcode district
    (addr("1 Church Street", "LS1 1AA"), addr("1 Church Street", "LS2 1AA")),

    # 19: building number order
    (addr("12-14 High Street", "EC1A 1AA"), addr("16-18 High Street", "EC1A 1AA")),

    # 20: completely empty vs real address
    ({}, addr("1 High Street", "N1 1AA")),
]


@pytest.mark.parametrize("a, b", NON_COLLIDING_PAIRS)
def test_non_colliding(a, b):
    ha, _ = normalise_address(a)
    hb, _ = normalise_address(b)
    assert ha != hb, f"Expected different hashes:\n  {a}\n  {b}\n  both got {ha!r}"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_empty_dict_returns_nopostcode(self):
        h, _ = normalise_address({})
        assert h.startswith("nopostcode:")

    def test_no_postcode_returns_nopostcode_prefix(self):
        h, _ = normalise_address({"address_line_1": "Some Street"})
        assert h.startswith("nopostcode:")

    def test_idempotent(self):
        a = addr("12 Acacia Avenue", "N1 7AB")
        h1, human1 = normalise_address(a)
        # Second call with the already-normalised human form
        h2, _ = normalise_address({"address_line_1": human1.split(",")[0], "postal_code": "N1 7AB"})
        assert h1 == h2

    def test_human_readable_contains_postcode(self):
        _, human = normalise_address(addr("10 High Street", "SW1A 1AA"))
        assert "SW1A 1AA" in human

    def test_none_values_handled(self):
        h, _ = normalise_address({
            "address_line_1": None,
            "postal_code": None,
        })
        assert h.startswith("nopostcode:")

    def test_all_caps_address(self):
        h1, _ = normalise_address(addr("10 HIGH STREET", "EC1A 1AA"))
        h2, _ = normalise_address(addr("10 High Street", "EC1A 1AA"))
        assert h1 == h2

    def test_unicode_smart_quotes(self):
        h1, _ = normalise_address({"address_line_1": "“1 Oak Street”", "postal_code": "N1 1AA"})
        h2, _ = normalise_address(addr("1 Oak Street", "N1 1AA"))
        assert h1 == h2

    def test_postcode_extracted_from_locality(self):
        h1, _ = normalise_address({"address_line_1": "1 High St", "locality": "London EC1A 1AA"})
        h2, _ = normalise_address(addr("1 High St", "EC1A 1AA"))
        assert h1 == h2

    def test_returns_tuple(self):
        result = normalise_address(addr("1 High Street", "N1 1AA"))
        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_hash_is_hex_string(self):
        h, _ = normalise_address(addr("1 High Street", "N1 1AA"))
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_length(self):
        h, _ = normalise_address(addr("1 High Street", "N1 1AA"))
        # SHA1 produces 40 hex chars
        assert len(h) == 40
