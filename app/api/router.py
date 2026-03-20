from fastapi import APIRouter

from app.api.endpoints import auth, countries, departments, events, templates, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(countries.router)
api_router.include_router(departments.router)
api_router.include_router(users.router)
api_router.include_router(events.router)
api_router.include_router(templates.router)
