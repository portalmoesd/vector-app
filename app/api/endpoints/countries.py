from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Country
from app.schemas.country import CountryOut

router = APIRouter(prefix="/countries", tags=["countries"])


REGIONS: dict[str, list[str]] = {
    "Neighbors": ["BY", "UA", "MD", "RU", "AZ", "AM", "KZ", "TJ", "KG", "UZ", "TM"],
    "EU": [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
        "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
        "SI", "ES", "SE",
    ],
    "Other Europe": [
        "AL", "AD", "BA", "CH", "IS", "LI", "MC", "ME", "MK", "NO", "RS", "SM",
        "TR", "GB", "VA", "GE", "XK",
    ],
    "North America": ["US", "CA", "MX", "GL", "BM"],
    "Central America & Caribbean": [
        "BZ", "CR", "SV", "GT", "HN", "NI", "PA", "AG", "BS", "BB", "CU", "DM",
        "DO", "GD", "HT", "JM", "KN", "LC", "VC", "TT", "PR",
    ],
    "South America": [
        "AR", "BO", "BR", "CL", "CO", "EC", "GY", "PY", "PE", "SR", "UY", "VE",
        "FK", "GF",
    ],
    "Africa": [],  # All countries not in other regions with AF continent
    "Asia": [],     # All countries not in other regions with AS continent
    "Oceania": [
        "AU", "NZ", "FJ", "FM", "KI", "MH", "NR", "PW", "PG", "WS", "SB", "TO",
        "TV", "VU",
    ],
}


@router.get("/", response_model=list[CountryOut])
def list_countries(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    return db.query(Country).order_by(Country.name_en).all()


@router.get("/regions")
def list_regions():
    """Return region groupings (UI-only, not stored in DB)."""
    return REGIONS
