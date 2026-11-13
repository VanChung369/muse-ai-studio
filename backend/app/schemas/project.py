from datetime import UTC, datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

ProjectStatus = Literal["draft", "planning", "ready", "rendering", "cancelling", "cancelled", "failed", "completed"]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    idea: str = Field(default="", max_length=12000)
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    duration_seconds: int = Field(default=60, strict=True, ge=10, le=300, multiple_of=5)

    @field_validator("name", "idea", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class ProjectScene(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True,
        from_attributes=True, extra="forbid", str_strip_whitespace=True,
    )

    number: int = Field(strict=True, ge=1, le=30)
    title: str = Field(min_length=1, max_length=300)
    prompt: str = Field(min_length=1, max_length=6000)
    duration_seconds: int = Field(strict=True, ge=5, le=10, multiple_of=5)
    narration: str = Field(default="", max_length=600)


class ProjectScriptUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True,
        extra="forbid", str_strip_whitespace=True,
    )

    expected_revision: int = Field(strict=True, ge=0)
    character_bible: str = Field(default="", max_length=10000)
    visual_style: str = Field(default="", max_length=3000)
    scenes: list[ProjectScene] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_scene_order(self):
        if [scene.number for scene in self.scenes] != list(range(1, len(self.scenes) + 1)):
            raise ValueError("Scenes must be numbered consecutively from 1.")
        return self


ProjectFilter = Literal["all", "inProgress", "completed", "cancelled"]
ProjectSort = Literal["updated", "name", "duration"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, from_attributes=True)


class ProjectSummary(CamelModel):
    """Fields a project card needs. Excludes `idea` and `scenes`, which can be
    large; fetch `GET /api/projects/{id}` for the full project."""

    id: str
    name: str
    status: ProjectStatus
    aspect_ratio: Literal["16:9", "9:16", "1:1"]
    duration_seconds: int
    created_at: datetime
    updated_at: datetime
    scene_count: int = 0
    completed_scenes: int = 0
    cover_tone: Literal["coffee"] = "coffee"

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_utc(cls, value: datetime) -> datetime:
        # SQLite restores timezone-free datetimes; stored values are always UTC.
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class ProjectResponse(ProjectSummary):
    idea: str
    character_bible: str
    visual_style: str
    script_revision: int
    scenes: list[ProjectScene] = Field(default_factory=list)


class ProjectSceneTitle(CamelModel):
    number: int
    title: str


PREVIEW_SCENE_LIMIT = 6


class FeaturedProject(ProjectSummary):
    # Up to six scene titles for the "Continue working" preview. Read from the
    # ORM `Project.scenes` relationship (ordered by number) when validating.
    preview_scenes: list[ProjectSceneTitle] = Field(
        default_factory=list,
        validation_alias=AliasChoices("scenes", "previewScenes", "preview_scenes"),
    )

    @field_validator("preview_scenes", mode="before")
    @classmethod
    def limit_preview(cls, value):
        return list(value)[:PREVIEW_SCENE_LIMIT]


class ProjectCounts(CamelModel):
    all: int
    in_progress: int
    completed: int
    cancelled: int


class ProjectListResponse(CamelModel):
    items: list[ProjectSummary]
    # Number of projects matching `q` and `status`, across all pages.
    total: int
    # Opaque token for the next page, or null on the last page.
    next_cursor: str | None
    # Per-filter totals for the status chips. Ignores `q` and `status`.
    counts: ProjectCounts
    # Most recently updated project awaiting review, else in progress.
    # Ignores `q` and `status`.
    featured: FeaturedProject | None
