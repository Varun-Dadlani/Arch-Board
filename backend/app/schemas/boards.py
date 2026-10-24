from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    document: dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})

class BoardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    document: dict[str, Any] | None = None

class BoardRead(BaseModel):
    id: UUID
    name: str
    document: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    owner_id: UUID
    member_role: str = "owner"
    
    model_config = {"from_attributes": True}


class BoilerplateRead(BaseModel):
    project_name: str
    technologies: list[str]
    files: dict[str, Any]


class BoilerplateCreate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    document: dict[str, Any] | None = None

class BoardMemberAdd(BaseModel):
    user_id: UUID
    role: Literal["editor", "viewer"] = "editor"

class BoardMemberRoleUpdate(BaseModel):
    role: Literal["editor", "viewer"]


class BoardMemberRead(BaseModel):
    user_id: UUID
    username: str
    role: str
    is_active: bool


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class ChatMessageRead(BaseModel):
    id: UUID
    user_id: UUID
    username: str
    content: str
    created_at: datetime