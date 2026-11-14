"""Typed contract for EMBER. Everything crossing a boundary (corpus load, HTTP request,
store read) is validated through these models."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Verification = Literal["provisional", "verified"]
ValueKind = Literal["reported", "series", "derived", "assumed", "unknown"]
EventKind = Literal[
    "ignition_attempt", "flame_establishment", "sustained_spread", "hot_extinction",
    "continued_cool_burning", "final_extinction", "fuel_exhaustion", "disruption",
    "operator_termination",
]
StepKind = Literal["prep", "ignition", "flow_change", "gas_change", "intervention", "termination", "measurement"]
Endpoint = Literal[
    "ignition", "flame_establishment", "sustained_spread", "extinction_under_flow_reduction",
    "cool_burning", "smoke_detection", "suppression",
]
Environment = Literal["iss", "gateway", "lunar_base", "mars_transit", "rover", "other"]
Topic = Literal["prevention", "detection", "suppression"]
Status = Literal["direct", "limited_context", "incompatible", "insufficient_data"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceRef(Strict):
    source_id: str = Field(min_length=1)
    url: str = ""
    locator: str = ""
    quote: str | None = None


class ScientificValue(Strict):
    kind: ValueKind = "unknown"
    value: float | int | str | None = None
    unit: str | None = None
    role: str | None = None
    source_ref: SourceRef | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_bool(cls, data: Any):
        if isinstance(data, dict) and isinstance(data.get("value"), bool):
            raise ValueError("value must be number or string, not bool")
        return data

    @model_validator(mode="after")
    def _kind_value(self):
        if self.kind == "unknown" and self.value is not None:
            raise ValueError("an unknown value must not carry a value")
        if self.kind != "unknown" and self.value is None:
            raise ValueError(f"kind '{self.kind}' requires a value; use kind 'unknown' otherwise")
        return self

    def is_known(self) -> bool:
        return self.kind != "unknown" and self.value is not None

    def is_measured(self) -> bool:
        return self.kind in ("reported", "series", "derived") and self.value is not None

    def number(self) -> float | None:
        return float(self.value) if self.is_known() and isinstance(self.value, (int, float)) else None


def unknown() -> ScientificValue:
    return ScientificValue()


def _sv() -> Any:
    return Field(default_factory=ScientificValue)


class Geometry(Strict):
    shape: str | None = None
    thickness_mm: ScientificValue = _sv()
    width_mm: ScientificValue = _sv()
    diameter_mm: ScientificValue = _sv()


class Atmosphere(Strict):
    o2_fraction: ScientificValue = _sv()  # role: ambient | oxidizer_stream
    pressure_kpa: ScientificValue = _sv()
    diluent: ScientificValue = _sv()


class Gravity(Strict):
    regime: Literal["microgravity", "partial", "normal", "unknown"] = "unknown"
    platform: str = ""
    actual: bool | None = None  # False = simulated / analogue
    value_g: ScientificValue = _sv()


class Flow(Strict):
    direction: ScientificValue = _sv()  # concurrent | opposed | quiescent
    initial_velocity_cm_s: ScientificValue = _sv()
    history_summary: str = ""
    history_kind: Literal["constant", "stepwise_reduction", "continuous_ramp", "reduction", "other", "unknown"] = "unknown"


class ProtocolStep(Strict):
    order: int
    kind: StepKind
    description: str
    time_s: ScientificValue = _sv()
    source_ref: SourceRef | None = None


class Event(Strict):
    kind: EventKind
    step_order: int | None = None
    time_s: ScientificValue = _sv()
    source_ref: SourceRef | None = None
    observed: bool = True
    note: str = ""


class Measurement(Strict):
    name: str
    unit: str | None = None
    kind: Literal["series", "reported", "derived", "unknown"] = "unknown"
    description: str = ""
    source_ref: SourceRef | None = None


class Test(Strict):
    __test__ = False
    id: str
    investigation_id: str
    series: str
    sample_id: str = ""
    material: str | None = None
    phase: Literal["solid", "liquid", "aerosol", "gas", "unknown"] = "unknown"
    geometry: Geometry = Field(default_factory=Geometry)
    substrate_confinement: str | None = None
    orientation: str | None = None
    atmosphere: Atmosphere = Field(default_factory=Atmosphere)
    gravity: Gravity = Field(default_factory=Gravity)
    flow: Flow = Field(default_factory=Flow)
    protocol: list[ProtocolStep] = []
    events: list[Event] = []
    measurements: list[Measurement] = []
    observation_status: Literal["planned", "observed"] = "observed"
    events_complete: bool = False  # True only if the record lists ALL events of the run
    record_type: Literal["series_description", "exemplar"] = "series_description"
    curation_note: str = ""
    verification: Verification = "provisional"

    @model_validator(mode="after")
    def _orders(self):
        orders = [s.order for s in self.protocol]
        if len(orders) != len(set(orders)):
            raise ValueError("duplicate protocol step order")
        for e in self.events:
            if e.step_order is not None and e.step_order not in orders:
                raise ValueError(f"event {e.kind} references missing step_order {e.step_order}")
        return self


class TextChunk(Strict):
    id: str
    section: str
    text: str


class Investigation(Strict):
    id: str
    name: str
    summary_goal: str
    platform: str = ""
    families: list[str] = []
    materials: list[str] = []
    measurements: list[str] = []
    topics: list[Topic] = []
    status: Literal["planned", "observed", "mixed"] = "observed"
    verification: Verification = "provisional"
    coverage: Literal["deep", "catalog"] = "catalog"
    sources: list[SourceRef] = []
    tests: list[str] = []
    limitations: list[str] = []
    text_chunks: list[TextChunk] = []


class Claim(Strict):
    id: str
    text: str
    type: Literal["observation", "source_interpretation", "derived_interpretation"]
    evidence: list[str] = []
    conditions: dict[str, Any] = {}
    limitations: list[str] = []
    verification: Verification = "provisional"


class SourceManifestEntry(Strict):
    id: str
    url: str = ""
    title: str
    retrieved: str | None = None
    hash: str | None = None
    type: str = "web_page"
    note: str = ""


class QueryConfig(Strict):
    material: str | None = None
    shape: str | None = None
    thickness_mm: float | None = Field(default=None, gt=0)
    o2_fraction: float | None = Field(default=None, ge=0, le=1)
    pressure_kpa: float | None = Field(default=None, gt=0)
    gravity_regime: Literal["microgravity", "partial", "normal"] | None = None
    flow_direction: Literal["concurrent", "opposed", "quiescent"] | None = None
    flow_velocity_cm_s: float | None = Field(default=None, ge=0)
    ignition: str | None = None
    # optional refinements (not in the minimal contract; null = unknown)
    o2_role: Literal["ambient", "oxidizer_stream"] | None = None
    substrate: str | None = None
    flow_history: Literal["constant", "stepwise_reduction", "continuous_ramp"] | None = None


class ResearchQuery(Strict):
    question: str = ""
    environment: Environment = "iss"
    topic: Topic | None = None
    endpoint: Endpoint | None = None
    config: QueryConfig = Field(default_factory=QueryConfig)


class Ground(Strict):
    rule_id: str
    field: str
    effect: Literal["pass", "fail", "unknown"]
    text: str


class ApplicabilityDecision(Strict):
    test_id: str
    status: Status
    grounds: list[Ground] = []
    unknown_fields: list[str] = []
    rule_version: str


class Contrast(Strict):
    id: str
    test_a: str
    test_b: str
    question: str
    allowed: bool
    changed_factors: list[str] = []
    shared: list[str] = []
    unknown: list[str] = []
    statement: str
    rule_ids: list[str] = []


class ReviewClaim(Strict):
    id: str
    text: str
    type: Literal["observation", "source_interpretation", "derived_interpretation"]
    evidence: list[str] = []
    rule_ids: list[str] = []
    conditions: dict[str, Any] = {}
    status: Literal["supported", "needs_new_comparison", "not_applicable"]
    why: str = ""
    depends_on_fields: list[str] = []  # query/test condition fields this claim was derived from


class Insight(Strict):
    id: str
    topic: Topic
    observation: str
    interpretation: str
    possible_application: str
    conditions: dict[str, Any] = {}
    open_questions: list[str] = []
    claim_ids: list[str] = []


class OpenQuestion(Strict):
    id: str
    kind: Literal["missing_condition", "needs_comparison", "endpoint_gap"]
    text: str
    field: str | None = None
    endpoint: str | None = None
    test_ids: list[str] = []


class TestBlock(Strict):
    __test__ = False
    id: str
    question_id: str
    target: dict[str, Any]
    control: dict[str, Any]
    fixed: dict[str, Any]
    changed: dict[str, Any]
    endpoint: str
    measurements: list[str]
    replicates: int
    replicate_rationale: str
    equipment: list[str]
    runs: int
    assumptions: list[str]
    covers: list[str] = []

    @model_validator(mode="after")
    def _mandatory(self):
        if not self.control:
            raise ValueError("a test block must define a control")
        if self.replicates < 2:
            raise ValueError("at least 2 replicates are mandatory")
        return self


class TestProgramme(Strict):
    __test__ = False
    blocks: list[TestBlock]
    selected: list[str]
    runs_used: int
    budget_runs: int
    covered: list[str]
    uncovered: list[str]
    method: Literal["exact", "greedy"]
    note: str


class RankingItem(Strict):
    investigation_id: str
    relevance: float
    applicability_summary: dict[str, int]
    quality: dict[str, Any]
    why: str


class TestConsidered(Strict):
    __test__ = False
    test_id: str
    endpoint_support: Literal["observed", "partial", "not_observed", "unknown", "planned"]
    decisions: list[ApplicabilityDecision]


class Explanation(Strict):
    mode: Literal["live_ai", "deterministic", "saved_example"]
    summary: str
    paragraphs: list[str] = []
    warnings: list[str] = []
    model: str | None = None


class Review(Strict):
    id: str
    revision: int = 1
    created: str
    query: ResearchQuery
    mode: Literal["live_ai", "deterministic", "saved_example"]
    manifest: dict[str, Any]
    ranking: list[RankingItem] = []
    tests_considered: list[TestConsidered] = []
    contrasts: list[Contrast] = []
    claims: list[ReviewClaim] = []
    safety_insights: list[Insight] = []
    conflicts: list[Any] = []
    limitations: list[str] = []
    open_questions: list[OpenQuestion] = []
    programme: TestProgramme | None = None
    warnings: list[str] = []
    explanation: Explanation | None = None
    parent_id: str | None = None
    variant_patch: dict[str, Any] | None = None
