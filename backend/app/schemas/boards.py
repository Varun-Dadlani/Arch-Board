from datetime import datetime
from typing import Any
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
    
    model_config = {"from_attributes": True}


class BoilerplateRead(BaseModel):
    project_name: str
    technologies: list[str]
    files: dict[str, Any]


class BoilerplateCreate(BaseModel):
    document: dict[str, Any] | None = None

class BoardMemberAdd(BaseModel):
    user_id: UUID
    role: str = Field(default="editor", min_length=1, max_length=20)