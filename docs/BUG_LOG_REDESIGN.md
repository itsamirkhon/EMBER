# Bug log — redesign session (2026-11-15)

Bugs found while redesigning the site. Each entry says whether this branch fixed it or left it for another agent.
Branch: `redesign/flight-plan`.

| # | Severity | Where | What | Status |
|---|---|---|---|---|
| 1 | **Blocker** | `ember-final/src/ui/v3/pages/HomePage.tsx` on `main` (77a28bb) | The merge of PR #4 and PR #5 spliced two versions of the file together: unclosed `<section>`/`<ol>`, a stray `))}`, and a reference to `apollo`, which is never defined. `npm run build` fails at `tsc`, so the GitHub Pages and AWS deploys from `main` cannot succeed. Vitest still passes because no test imports HomePage. | Fixed on this branch: restored the `6e079cc` version, then rewrote it during the redesign. |
| 2 | Build | `ember-final/src/ui/v3/pages/MapPage.tsx` on `main` | Unused `Term` import, another merge leftover. Fails `tsc` with `noUnusedLocals`. | Fixed on this branch. |
| 3 | CI gap | `.github/workflows/*` | CI ran `npm test` but the merge still landed broken, which suggests the merge commit's build was not required to pass before merging. | **Open**: make the `build` job a required check on `main`. |
| 4 | **Validity** | Hero copy, `SUBMISSION_2026.md`, pitch docs | "No NASA flight test burned a solid above 22.7% O₂" is false outside PSI: Saffire-VI test VI-2 burned SIBAL cloth at 31.0 mol% O₂ / 54.1 kPa on Cygnus, Jan 2024 (NTRS 20240002981). | Hero copy scoped to PSI on this branch. **Open:** the docs and the video script still need the same scoping. |
| 5 | Submission | Demo/video | Indexed Space Apps guide says the demo is ≤30 s of video or ≤7 slides, and longer entries are excluded from global judging. The 2-minute script in `docs/` would disqualify. | **Open:** confirm on the form, then cut the video. |
| 6 | Positioning | Docs | Competing projects with the same argument: SPICA "The 34% Question" (19 investigations, 22.2% max) and MicroFire Atlas. Our 15 / 22.7% must explain its filter. | **Open:** add a one-line filter explanation to the submission text. |
| 7 | Build drift | `ember-final/intro-src/presentation.template.html` vs `public/intro.html` | The template lacks PR #4's `?embed=1` mode (22 `embed` rules in the built file, 0 in the template). Running `npm run intro` would silently delete embed mode. The redesign's chamber restyle was applied to `public/intro.html` directly for that reason. | **Open:** port the embed CSS and JS plus the Oxygen Green chamber block back into the template, then regenerate. |
| 8 | Hang | `ember-final/src/ui/v3/EvidenceSpace.tsx` label placement | Float rounding could re-trigger the overlap test forever and freeze the tab at some widths (reproduced at 899 px). Pre-existing loop; the new camera framing exposed it. | Fixed on `c-redesign` (tolerance plus iteration cap). |
| 9 | Test fragility | `tests/focused-lens.test.ts` | Asserts a multi-line source string joined with `\n`. On Windows with `core.autocrlf=true` the checkout has CRLF and the test fails locally, though the committed (LF) file passes and CI on Linux is unaffected. | **Open:** add `.gitattributes` with `* text=auto eol=lf`, or normalise `\r\n` in the test's `readFileSync`. |
