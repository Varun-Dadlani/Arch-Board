from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, verify_password, generate_password_hash
from app.database import get_db
from app.core.dependencies import get_current_user
from app.models.users import User
from app.schemas.users import TokenRead, UserCreate, UserLogin, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> User:
    user = User(
        username=payload.username,
        email=payload.email.lower(),
        password_hash=generate_password_hash(payload.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists") from None
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenRead)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)) -> TokenRead:
    result = await db.scalars(select(User).where(User.email == payload.email.lower()))
    user = result.first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenRead(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserRead)
async def current_user(user: User = Depends(get_current_user)) -> User:
    return user