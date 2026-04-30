"""meta.known_addresses: persistent allowlist for formation agents

Replaces the hardcoded FORMATION_AGENT_POSTCODES frozenset in
apps/worker/src/worker/anomaly_detector.py with an editable database table.
Anomaly detectors join against this table to suppress / cap scoring for
known registered-office services and formation agents.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Seed data — same set as the previous Python frozenset, with names attached.
# Postcodes are the disambiguating key. Address line is the public name.
SEED_FORMATION_AGENTS = [
    ("WC2H 9JQ", "71-75 Shelton Street, Covent Garden", "1st Formations / multi-agent address"),
    ("WC1N 3AX", "27 Old Gloucester Street", "Made Simple Group / Companies Made Simple"),
    ("EC1V 2NX", "128 City Road", "Multiple formation agents"),
    ("EC1V 2NJ", "City Road (variation)", "Multiple formation agents"),
    ("EC1V 2NW", "City Road (variation)", "Multiple formation agents"),
    ("N1 7GU",   "20 Wenlock Road", "Hoxton Mix / former Wise service address"),
    ("N1 7GN",   "Wenlock Road (variation)", "Hoxton Mix area"),
    ("SL9 0BG",  "Gerrards Cross", "Jacquards Spaces"),
    ("EC2A 4NA", "66 Paul Street", "Service address"),
    ("EC2A 4NE", "86-90 Paul Street", "Service address"),
    ("W1W 5PF",  "167-169 Great Portland Street", "Service address"),
    ("BR3 4AB",  "37 Croydon Road, Beckenham", "Service address"),
    ("HR5 3DJ",  "61 Bridge Street, Herefordshire", "Service address"),
    ("EH2 4AN",  "5 South Charlotte Street, Edinburgh", "Service address"),
    ("HG1 1ND",  "9 Princes Square, Harrogate", "Service address"),
    ("IP28 7DE", "James Carter Road, Bury St. Edmunds", "Service address"),
    ("DT1 2PJ",  "Railway Triangle, Dorchester", "Service address"),
    ("N21 3NA",  "1 Kings Avenue, London", "Service address"),
    ("DN6 8DA",  "Owston Road, Doncaster", "Service address"),
    ("W1B 3HH",  "Third Floor, London (Mayfair)", "Service address"),
    ("PO15 7AG", "Solent Business Park, Fareham", "Service address"),
    ("HA1 2EY",  "Cox Costello & Horne, Harrow", "Service address"),
    ("G1 3NQ",   "Gordon Chambers, Glasgow", "Service address"),
    ("HA4 7AE",  "College House, Ruislip", "Service address"),
    ("EH3 9WJ",  "50 Lothian Road, Edinburgh", "Service address"),
    ("SW1Y 4LB", "12 St. James's Square", "Service address"),
    ("SM4 6RW",  "Marshall House, Morden", "Service address"),
    ("BT38 7AW", "2 Market Place, Carrickfergus", "Service address"),
    ("NE3 2ER",  "Cheviot House, Newcastle", "Service address"),
]


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS meta")

    op.execute("""
        CREATE TABLE meta.known_addresses (
            id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            postcode                 text,
            address_line             text,
            label                    text NOT NULL,
            name                     text NOT NULL,
            notes                    text,
            suppress_from_anomalies  boolean NOT NULL DEFAULT true,
            score_cap                int NOT NULL DEFAULT 20,
            added_at                 timestamptz NOT NULL DEFAULT now(),
            added_by                 text NOT NULL DEFAULT 'seed'
        )
    """)

    # Postcodes are case-insensitive in the lookup. Store uppercased & trimmed.
    op.execute("""
        CREATE UNIQUE INDEX known_addresses_postcode_idx
            ON meta.known_addresses (upper(trim(postcode)))
            WHERE postcode IS NOT NULL
    """)

    # Seed
    for postcode, address_line, name in SEED_FORMATION_AGENTS:
        op.execute(f"""
            INSERT INTO meta.known_addresses
                (postcode, address_line, label, name, notes, suppress_from_anomalies, score_cap, added_by)
            VALUES (
                '{postcode}',
                '{address_line.replace("'", "''")}',
                'formation-agent',
                '{name.replace("'", "''")}',
                'Seeded from anomaly_detector.py FORMATION_AGENT_POSTCODES',
                false,
                20,
                'migration:0002'
            )
        """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS meta.known_addresses CASCADE")
