# EMBER corpus (provisional seed)

This corpus is a **team-curated provisional seed**. It must be verified against the cited sources before any record is treated as established. Every record carries `verification: "provisional"`.

Files: `manifest.json` (corpus version + sha256 and record count per file, checked at load), `investigations.json`, `tests.json`, `claims.json`, `sources.json`.

## What is unverified (exactly)
- **Every numeric condition is `{"kind":"unknown"}`** (diameters, thicknesses, widths, flow velocities, O2 fractions, pressures, times) except:
  - nominal ISS cabin values (O2 fraction 0.21, pressure 101.3 kPa) on exemplar records and on the SAME record, marked `kind: "assumed"`; they are not run-specific measurements;
  - placeholder labels (e.g. `setting-A`, `thin_class`) on exemplars, `kind: "assumed"`, role `placeholder_label`.
- Facility names (BASS-II/FLEX/FLEX-2 "Combustion Integrated Rack", SAME/SIBAL glovebox/ISS) are provisional.
- Event lists on non-exemplar records are incomplete (`events_complete: false`): absence of an event means "not recorded", not "did not happen".
- Which materials were burned in Saffire-II and Saffire-III, and Saffire flow direction/velocity: unknown, left blank.
- The material list of SAME is unknown.
- Whether SIBAL, Saffire and FLEX runs ended in extinction is not recorded.
- BASS-II flow direction and the flow reduction schedule: unknown.
- No source was downloaded or hashed by the corpus builders (`retrieved`/`hash` are null). Only two URLs are included, both given by the team lead:
  BASS-II NTRS 20210011385 and the NASA FLEX-2 cool-flame page. The exact BASS-II title is not verified. Other sources are `citation_pending` with an empty URL.
- No verbatim quotes are stored (`quote: null`).

## Exemplar tests
Records with `record_type: "exemplar"` (ids containing `_ex_`) are structural fixtures written by the team to exercise comparison rules (same initial flow with different flow history, operator termination vs extinction, thickness/substrate differences, ambient O2 vs oxidizer stream, actual vs simulated gravity, planned vs observed). They are not NASA measurements and are labelled in `curation_note`.

## Not included
Suppression-specific investigations (e.g. MDCA-type work) were deliberately left out: the team was not confident of the facts.

## Editing
After editing any JSON file run `python -m ember.corpus --rehash` from `backend/` to refresh `manifest.json`; the loader refuses a corpus whose hashes do not match.
