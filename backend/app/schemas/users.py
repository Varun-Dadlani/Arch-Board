from uuid import UUID

from pydantic import BaseModel, Field

class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class UserRead(BaseModel):
    id: UUID
    username: str
    email: str

    model_config = {"from_attributes": True}


class TokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
