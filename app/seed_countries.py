"""Seed the countries table using the pycountry-compatible ISO data.

Run: python -m app.seed_countries
"""

from sqlalchemy.orm import Session

from app.core.database import SessionLocal, engine
from app.core.database import Base
from app.models import Country

# Minimal set of countries referenced in the design document regions.
# In production, use the full ISO 3166-1 list via pycountry or a CSV import.
COUNTRIES = [
    # Neighbors
    ("Belarus", "BY"), ("Ukraine", "UA"), ("Moldova", "MD"), ("Russia", "RU"),
    ("Azerbaijan", "AZ"), ("Armenia", "AM"), ("Kazakhstan", "KZ"),
    ("Tajikistan", "TJ"), ("Kyrgyzstan", "KG"), ("Uzbekistan", "UZ"), ("Turkmenistan", "TM"),
    # EU
    ("Austria", "AT"), ("Belgium", "BE"), ("Bulgaria", "BG"), ("Croatia", "HR"),
    ("Cyprus", "CY"), ("Czech Republic", "CZ"), ("Denmark", "DK"), ("Estonia", "EE"),
    ("Finland", "FI"), ("France", "FR"), ("Germany", "DE"), ("Greece", "GR"),
    ("Hungary", "HU"), ("Ireland", "IE"), ("Italy", "IT"), ("Latvia", "LV"),
    ("Lithuania", "LT"), ("Luxembourg", "LU"), ("Malta", "MT"), ("Netherlands", "NL"),
    ("Poland", "PL"), ("Portugal", "PT"), ("Romania", "RO"), ("Slovakia", "SK"),
    ("Slovenia", "SI"), ("Spain", "ES"), ("Sweden", "SE"),
    # Other Europe
    ("Albania", "AL"), ("Andorra", "AD"), ("Bosnia and Herzegovina", "BA"),
    ("Switzerland", "CH"), ("Iceland", "IS"), ("Liechtenstein", "LI"), ("Monaco", "MC"),
    ("Montenegro", "ME"), ("North Macedonia", "MK"), ("Norway", "NO"), ("Serbia", "RS"),
    ("San Marino", "SM"), ("Turkey", "TR"), ("United Kingdom", "GB"),
    ("Vatican City", "VA"), ("Georgia", "GE"), ("Kosovo", "XK"),
    # North America
    ("United States", "US"), ("Canada", "CA"), ("Mexico", "MX"),
    ("Greenland", "GL"), ("Bermuda", "BM"),
    # Central America & Caribbean
    ("Belize", "BZ"), ("Costa Rica", "CR"), ("El Salvador", "SV"),
    ("Guatemala", "GT"), ("Honduras", "HN"), ("Nicaragua", "NI"), ("Panama", "PA"),
    ("Antigua and Barbuda", "AG"), ("Bahamas", "BS"), ("Barbados", "BB"),
    ("Cuba", "CU"), ("Dominica", "DM"), ("Dominican Republic", "DO"),
    ("Grenada", "GD"), ("Haiti", "HT"), ("Jamaica", "JM"),
    ("Saint Kitts and Nevis", "KN"), ("Saint Lucia", "LC"),
    ("Saint Vincent and the Grenadines", "VC"),
    ("Trinidad and Tobago", "TT"), ("Puerto Rico", "PR"),
    # South America
    ("Argentina", "AR"), ("Bolivia", "BO"), ("Brazil", "BR"), ("Chile", "CL"),
    ("Colombia", "CO"), ("Ecuador", "EC"), ("Guyana", "GY"), ("Paraguay", "PY"),
    ("Peru", "PE"), ("Suriname", "SR"), ("Uruguay", "UY"), ("Venezuela", "VE"),
    ("Falkland Islands", "FK"), ("French Guiana", "GF"),
    # Oceania
    ("Australia", "AU"), ("New Zealand", "NZ"), ("Fiji", "FJ"),
    ("Micronesia", "FM"), ("Kiribati", "KI"), ("Marshall Islands", "MH"),
    ("Nauru", "NR"), ("Palau", "PW"), ("Papua New Guinea", "PG"),
    ("Samoa", "WS"), ("Solomon Islands", "SB"), ("Tonga", "TO"),
    ("Tuvalu", "TV"), ("Vanuatu", "VU"),
    # Selected Africa
    ("South Africa", "ZA"), ("Nigeria", "NG"), ("Egypt", "EG"), ("Kenya", "KE"),
    ("Ethiopia", "ET"), ("Ghana", "GH"), ("Morocco", "MA"), ("Tanzania", "TZ"),
    ("Algeria", "DZ"), ("Tunisia", "TN"), ("Senegal", "SN"), ("Uganda", "UG"),
    ("Mozambique", "MZ"), ("Cameroon", "CM"), ("Angola", "AO"),
    # Selected Asia
    ("China", "CN"), ("Japan", "JP"), ("South Korea", "KR"), ("India", "IN"),
    ("Indonesia", "ID"), ("Thailand", "TH"), ("Vietnam", "VN"),
    ("Philippines", "PH"), ("Malaysia", "MY"), ("Singapore", "SG"),
    ("Israel", "IL"), ("Saudi Arabia", "SA"), ("United Arab Emirates", "AE"),
    ("Pakistan", "PK"), ("Bangladesh", "BD"), ("Sri Lanka", "LK"),
    ("Mongolia", "MN"), ("Nepal", "NP"), ("Myanmar", "MM"), ("Cambodia", "KH"),
    ("Laos", "LA"), ("Iraq", "IQ"), ("Iran", "IR"), ("Jordan", "JO"),
    ("Lebanon", "LB"), ("Kuwait", "KW"), ("Bahrain", "BH"), ("Qatar", "QA"),
    ("Oman", "OM"), ("Yemen", "YE"),
]


def seed(db: Session):
    existing = db.query(Country).count()
    if existing > 0:
        print(f"Countries table already has {existing} rows, skipping seed.")
        return

    for name, code in COUNTRIES:
        db.add(Country(name_en=name, code=code))
    db.commit()
    print(f"Seeded {len(COUNTRIES)} countries.")


if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
