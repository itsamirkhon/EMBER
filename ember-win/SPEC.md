# EMBER-win — build contract (shared by backend and frontend)

Product: EMBER, Spacecraft Fire Evidence Lab (see ../EMBER_concept.md style brief given by the user).
Stack: `backend/` Python 3.14 + FastAPI (+pydantic v2, stdlib sqlite3, own BM25; no heavy deps) · `frontend/` React + TypeScript + Vite.
Backend on :8000, frontend dev server on :5173 proxying `/api` -> :8000.
HARD RULE: nothing is copied from ../ember-final. Do not read it.

## Honesty rules (apply to corpus + UI)
- Never invent numeric values. If not known from a cited public source, the field is `{"kind":"unknown"}`.
- Every corpus record carries `verification: "provisional"` unless checked against the cited document; UI shows it.
- Modes: `live_ai` | `deterministic` | `saved_example`. No LLM key is required; without OPENAI_API_KEY the explanation text is built deterministically from the evidence package and labelled `deterministic`.
- Jev/TypeSafe and dense embeddings are optional off-by-default branches (feature flags in /api/meta); retrieval default = BM25 + structured filters (RRF-merged).

## ScientificValue
`{"kind":"reported|series|derived|assumed|unknown","value":number|string|null,"unit":string|null,"role":string|null,"source_ref":SourceRef|null}`

## SourceRef
`{"source_id":str,"url":str,"locator":str,"quote":str|null}`

## Corpus (backend/data/*.json, loaded at startup)
- Investigation: `id,name,summary_goal,platform,families[],materials[],measurements[],topics[] (prevention|detection|suppression),status ("planned"|"observed"|"mixed"),verification,coverage ("deep"|"catalog"),sources[SourceRef],tests[Test ids],limitations[str],text_chunks[{id,section,text}]`
- Test: `id,investigation_id,series,sample_id,material,phase,geometry{shape,thickness_mm:SV,width_mm:SV,diameter_mm:SV},substrate_confinement,orientation,atmosphere{o2_fraction:SV(role ambient|oxidizer_stream),pressure_kpa:SV,diluent:SV},gravity{regime:"microgravity|partial|normal",platform,actual:bool,value_g:SV},flow{direction:SV,initial_velocity_cm_s:SV,history_summary:str},protocol:[ProtocolStep],events:[Event],measurements:[Measurement]`
- ProtocolStep: `order:int,kind:"prep|ignition|flow_change|gas_change|intervention|termination|measurement",description,time_s:SV,source_ref`
- Event: `kind` one of `ignition_attempt|flame_establishment|sustained_spread|hot_extinction|continued_cool_burning|final_extinction|fuel_exhaustion|disruption|operator_termination`, `step_order`, `time_s:SV`, `source_ref`. Never a single BURN.
- Claim: `id,text,type:"observation|source_interpretation|derived_interpretation",evidence[test ids/chunk ids],conditions,limitations,verification`

## Endpoints (all JSON; error = HTTP 4xx/5xx `{"error":{"code","message"}}`)
- `GET /api/meta` -> `{version, corpus_version, rules_version, mode, flags{jev,dense,live_ai}, coverage:{deep:[inv ids],catalog:[inv ids]}}`
- `GET /api/investigations?q=&topic=&material=&platform=&family=` -> `{items:[InvestigationCard]}` (BM25 ranked when q given; each item has `score`, `why` string)
- `GET /api/investigations/{id}` -> full Investigation + tests + `summary:{goal,method,materials,conditions_range,measurements,key_results,limitations}` (built from data, with source refs)
- `GET /api/sources/{id}` -> source manifest `{id,url,title,retrieved,hash,type}`
- `POST /api/queries/parse` body `{text?:str, config?:ResearchQuery}` -> `{query:ResearchQuery, missing:[field], confirm:[field]}`
- ResearchQuery: `{question,environment ("iss|gateway|lunar_base|mars_transit|rover|other"),topic,endpoint ("ignition|flame_establishment|sustained_spread|extinction_under_flow_reduction|cool_burning|smoke_detection|suppression"),config:{material,shape,thickness_mm:num|null,o2_fraction:num|null,pressure_kpa:num|null,gravity_regime,flow_direction:"concurrent|opposed|quiescent|null",flow_velocity_cm_s:num|null,ignition:str|null}}`; null = unknown.
- `POST /api/reviews` body `{query:ResearchQuery}` -> 202 `{run_id,review_id}`; `GET /api/runs/{run_id}` -> `{run_id,status:"queued|running|done|error",stage,error,review_id}` (synchronous execution acceptable but must still return this shape). Idempotency: header `Idempotency-Key` returns same review.
- `GET /api/reviews` -> list; `GET /api/reviews/{id}` -> Review.
- Review: `{id,revision,created,query,mode,manifest{corpus,rules,code,generator},ranking:[{investigation_id,relevance,applicability_summary,quality,why}],tests_considered:[{test_id,endpoint_support,decisions:[ApplicabilityDecision]}],contrasts:[Contrast],claims:[ReviewClaim],safety_insights:[Insight],conflicts:[],limitations:[],open_questions:[OpenQuestion],programme:null|TestProgramme,warnings:[]}`
- ApplicabilityDecision: `{test_id,status:"direct|limited_context|incompatible|insufficient_data",grounds:[{rule_id,field,effect:"pass|fail|unknown",text}],unknown_fields:[],rule_version}`
- Contrast: `{id,test_a,test_b,question,allowed:bool,changed_factors:[],shared:[],unknown:[],statement,rule_ids:[]}` — changing one recorded parameter is NOT stated as proven causation.
- ReviewClaim: `{id,text,type,evidence:[ids],rule_ids:[],conditions:{field:value},status:"supported|needs_new_comparison|not_applicable",why}` with dependency links so variants can recompute.
- Insight: `{id,topic,observation,interpretation,possible_application,conditions,open_questions,claim_ids}` (three layers kept separate).
- `POST /api/reviews/{id}/variants` body `{config_patch:{…}}` -> `{variant_id, diff:[{claim_id,before,after,changed_parameter,reason}], review:Review}`
- `POST /api/reviews/{id}/test-programmes` body `{budget_runs:int,must_cover?:[open_question ids]}` -> TestProgramme `{blocks:[TestBlock],selected:[ids],runs_used,budget_runs,covered:[],uncovered:[],method:"exact"|"greedy",note}`
- TestBlock: `{id,question_id,target,control,fixed,changed,endpoint,measurements:[],replicates:int,replicate_rationale,equipment:[],runs,assumptions:[]}` (control + >=2 replicates mandatory)
- `GET /api/reviews/{id}/export?format=report|json|csv|dataset` -> text/markdown | json | csv | csv-with-group-ids. dataset keeps unit, role, provenance, explicit blanks, group IDs, and refuses to merge incompatible endpoint families.
- `GET /api/reviews/{id}/replay/{test_id}` -> data replay timeline `{segments:[{label,kind,time_s|null,order}],events,measurements,disclaimer}` — labelled data replay, never a physics simulation.
- `GET /api/eval/summary` -> latest stored evaluation output (`{status:"measured|not_measured",...}`); unmeasured cells say "not measured".

## UI screens (frontend)
Review workspace · Experiment explorer · Investigation summary · Fire-safety insights · Protocol view · Comparison workspace · Design comparison · Test programme · Review export · Evaluation/coverage page · mode badge (live/deterministic/saved) · provisional-verification badges. Dark Apple-style theme, responsive.
