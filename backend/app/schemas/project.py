from datetime import UTC, datetime
from typing import Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

ProjectStatus = Literal[
    "draft",
    "planning",
    "ready",
    "rendering",
    "cancelling",
    "cancelled",
    "failed",
    "completed",
]
# A film is at most an hour long. A scene is 5 or 10 seconds, so that is
# also the most scenes a script can hold.
MAX_DURATION = 3600
MAX_SCENES = MAX_DURATION // 5
AspectRatio = Literal["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "21:9"]
# The film's visual look; `auto` leaves it to the script's visual style.
ProjectLook = Literal[
    "auto",
    "realistic",
    "cinematic",
    "documentary",
    "commercial",
    "animation3d",
    "anime",
]
# How a scene uses the last frame of the previous one: not at all, as a
# visual reference, or as its own first frame.
ProjectContinuity = Literal["off", "reference", "seamless"]
# Language of titles, narration and speech; `auto` follows the idea's language.
ProjectLanguage = Literal[
    "auto", "vi", "en", "zh", "ja", "ko", "es", "fr", "de", "pt", "th", "id"
]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, extra="forbid"
    )

    name: str = Field(min_length=1, max_length=100)
    idea: str = Field(default="", max_length=12000)
    # Optional starting points; a script written later can refine them.
    character_bible: str = Field(default="", max_length=10000)
    visual_style: str = Field(default="", max_length=3000)
    music: str = Field(default="", max_length=500)
    aspect_ratio: AspectRatio = "16:9"
    duration_seconds: int = Field(default=60, strict=True, ge=10, le=MAX_DURATION, multiple_of=5)
    look: ProjectLook = "auto"
    continuity: ProjectContinuity = "reference"
    language: ProjectLanguage = "auto"
    mute: bool = Field(default=False, strict=True)

    @field_validator(
        "name", "idea", "character_bible", "visual_style", "music", mode="before"
    )
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class ProjectUpdate(BaseModel):
    """Partial update. Name, idea, ratio and duration can change until a
    render starts; the render options until one is running."""

    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, extra="forbid"
    )

    name: str | None = Field(default=None, min_length=1, max_length=100)
    idea: str | None = Field(default=None, max_length=12000)
    character_bible: str | None = Field(default=None, max_length=10000)
    visual_style: str | None = Field(default=None, max_length=3000)
    music: str | None = Field(default=None, max_length=500)
    aspect_ratio: AspectRatio | None = None
    duration_seconds: int | None = Field(
        default=None, strict=True, ge=10, le=MAX_DURATION, multiple_of=5
    )
    look: ProjectLook | None = None
    continuity: ProjectContinuity | None = None
    language: ProjectLanguage | None = None
    mute: bool | None = Field(default=None, strict=True)
    # A saved script adds up to the current duration. Changing the
    # duration is refused unless the caller agrees to drop that script.
    discard_script: bool = Field(default=False, strict=True)

    @field_validator(
        "name", "idea", "character_bible", "visual_style", "music", mode="before"
    )
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def reject_nulls(self):
        # A field is either left out or given a value; null clears nothing.
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Fields cannot be null.")
        return self


class ProjectScene(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        from_attributes=True,
        extra="forbid",
        str_strip_whitespace=True,
    )

    number: int = Field(strict=True, ge=1, le=MAX_SCENES)
    title: str = Field(min_length=1, max_length=300)
    prompt: str = Field(min_length=1, max_length=6000)
    duration_seconds: int = Field(strict=True, ge=5, le=10, multiple_of=5)
    narration: str = Field(default="", max_length=600)


class ProjectScriptUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )

    expected_revision: int = Field(strict=True, ge=0)
    character_bible: str = Field(default="", max_length=10000)
    visual_style: str = Field(default="", max_length=3000)
    scenes: list[ProjectScene] = Field(min_length=1, max_length=MAX_SCENES)

    @model_validator(mode="after")
    def validate_scene_order(self):
        if [scene.number for scene in self.scenes] != list(
            range(1, len(self.scenes) + 1)
        ):
            raise ValueError("Scenes must be numbered consecutively from 1.")
        return self


ProjectFilter = Literal["all", "inProgress", "completed", "cancelled"]
ProjectSort = Literal["updated", "name", "duration"]


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, from_attributes=True
    )


class ProjectSummary(CamelModel):
    """Fields a project card needs. Excludes `idea` and `scenes`, which can be
    large; fetch `GET /api/projects/{id}` for the full project."""

    id: str
    name: str
    status: ProjectStatus
    aspect_ratio: AspectRatio
    duration_seconds: int
    created_at: datetime
    updated_at: datetime
    scene_count: int = 0
    completed_scenes: int = 0
    cover_tone: Literal["coffee"] = "coffee"

    @computed_field
    @property
    def cover_url(self) -> str | None:
        """A still of the first rendered scene; null until one exists."""
        if self.completed_scenes < 1:
            return None
        # Changes whenever a scene is rendered, so a new cover is not cached away.
        return f"/api/projects/{self.id}/cover?v={int(self.updated_at.timestamp())}"

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_utc(cls, value: datetime) -> datetime:
        # SQLite restores timezone-free datetimes; stored values are always UTC.
        return (
            value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        )


class ProjectReference(CamelModel):
    """A picture or video given as reference material for the film."""

    id: str
    project_id: str
    name: str
    mime: str
    size: int

    @computed_field
    @property
    def url(self) -> str:
        return f"/api/projects/{self.project_id}/references/{self.id}"


class ProjectResponse(ProjectSummary):
    idea: str
    look: ProjectLook
    continuity: ProjectContinuity
    language: ProjectLanguage
    # The film has no sound.
    mute: bool
    music: str
    references: list[ProjectReference] = Field(default_factory=list)
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
