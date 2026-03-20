from pydantic import BaseModel


class CountryOut(BaseModel):
    id: int
    name_en: str
    code: str

    model_config = {"from_attributes": True}
