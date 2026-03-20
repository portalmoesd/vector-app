"""Create initial admin user.

Run: python -m app.seed_admin
"""

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models import User, UserRole


def seed_admin():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.role == UserRole.ADMIN).first()
        if existing:
            print(f"Admin user already exists: {existing.username}")
            return

        admin = User(
            full_name="System Administrator",
            username="admin",
            email="admin@vector-portal.local",
            password_hash=hash_password("admin"),
            role=UserRole.ADMIN,
            department_id=None,
            is_external=False,
            must_change_password=True,
        )
        db.add(admin)
        db.commit()
        print("Admin user created (username: admin, password: admin)")
    finally:
        db.close()


if __name__ == "__main__":
    seed_admin()
