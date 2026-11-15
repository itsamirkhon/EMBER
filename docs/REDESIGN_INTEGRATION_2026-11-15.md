# EMBER focused redesign — integration handoff (2026-11-15)

## Decisions and source state
- Current working code branch: `redesign/focused-evidence`, branched from `main` at `77a28bbd04048f1f0554ab6443dfaadbde226742`.
- On that base commit, team PR #5 (3D mission-control) and PR #4 (protocol/export/evidence bug audit) had both been merged. Their merge produced a broken `HomePage.tsx` and an unused import in `MapPage.tsx`. `Verify EMBER` and the Lightsail deployment both failed on main run `43711256056` / `43711256001`.
- This branch repairs that integration, keeps the working Three.js scene, and substantially reduces the surface area of the primary workflow. It DOES NOT merge into main, change AWS infrastructure, or delete prototype directories.

## One product promise
Select a proposed spacecraft environment, choose a material, explicitly compare it against historical NASA PSI flight records, and inspect the named source experiments and gaps. No new burn test, invented outcome, flammability threshold, or fire-risk percentage.

## UI structure (deliberately small)
- Home: one headline; one CTA to Lens; one moving source-derived 3D evidence field; one scoped finding with a route into the source map. Removed duplicated flame iframe, story timeline, tool grid, promotional KPI panels and competing CTAs.
- Lens: environment dropdown, material, oxygen, pressure, explicit **Check historical evidence** action and result. Research task, airflow/gravity and multi-scale rank list remain behind native, accessible disclosure controls. Nearest tests only appear after a check.
- Header: one visible primary nav action. Map, investigation details, protocol comparison, exports, Ask, Trust, Earth and review workbench remain accessible under More; nothing is silently deleted.
- 3D: continuous slow orbital motion unless reduced-motion is requested or the visitor interacts, true positions from reportable O2/pressure/gravity, excludes unknown coordinates, drops decorative random stars and arbitrary point jitter. The 2D scientific map remains the fallback without WebGL.

## Colors are provisional
The request referenced a personal hex palette, but no explicit user-provided codes were present in the accessible conversation/context. Do **not** claim the design uses that palette. Current restrained token set: graphite `#121411`, chalk `#f1f0e8`, muted signal `#a74c58`. Main color tokens live in `ember-final/src/ui/v3/v3.css`; Three.js marks/background in `ember-final/src/ui/v3/EvidenceSpace.tsx`. Replace as one coordinated palette review when the actual colors are supplied, preserving contrast and scientific categorical distinctions.

## Files changed
- `ember-final/src/ui/v3/pages/HomePage.tsx`: rewrite broken/overloaded main-page composition
- `ember-final/src/ui/v3/pages/LensPage.tsx`: narrow to one primary evidence-check flow
- `ember-final/src/ui/v3/EvidenceSpace.tsx`: real observed-coordinate 3D + restrained motion
- `ember-final/src/ui/v3/v3.css`: cohesive semantic tokens and responsive, minimal layout
- `ember-final/src/ui/components/Layout.tsx`: single primary action, research submenu
- `ember-final/src/ui/v3/pages/MapPage.tsx`: restore TypeScript compile after conflicting main merge
- `ember-final/tests/focused-home.test.ts`, `focused-lens.test.ts`, `protocol-deeplink.test.ts`: updated regression coverage
- `README.md`: one current workflow, scoped science claims

## Release and integration sequence
1. **Do not cherry-pick fragments into main while teammates have outstanding branches.** Have Ibrohim identify the remaining merge order; inspect the PR file lists and preserve unrelated work.
2. Before approving, fetch latest main, review branch diff for conflicts, integrate teammates' new work into the branch (not by resetting or overwriting main), rerun all tests. If main changes, the branch verification for an older base is no longer sufficient.
3. `cd ember-final && npm run lint && npm test && npm run test:intro && npm run build`.
4. Browser test at desktop and 390px mobile viewport: initial homepage, 3D rotation / reduced motion, GPU fallback, scenario prefill, explicit Lens check, nearest protocols and source URLs, working export files, keyboard navigation. Check HTTP and console failures. These checks are NOT performed via GitHub source reads.
5. Review PR, merge only after a staging acceptance; merging main triggers AWS Lightsail release. Verify `/ember-version.txt` matches the merge commit; confirm live site in incognito, data MIME/content and error-free routes. Keep rollback ready.
6. **After submission**, separately consider moving `web/` and `ember-win/` to `archive/` with ownership approval. Do not delete them simply because `ember-final/` is authoritative.

## Visual and browser acceptance record (isolated branch artifact)
- Built output was retrieved from GitHub Actions artifact `ember-focused-preview` (run `43712790302`, commit `49bc22477`). The *actual production JavaScript/CSS/data bundle* was exercised with headless Chromium at **1440×900** and **390×844** using a local virtual-file transport because direct HTTP navigation is blocked by this execution environment.
- **Observed pass:** homepage mounted and displayed the single CTA and minimal evidence panel; desktop/mobile layouts had no uncaught browser exceptions; `#/lens` rendered the mission/form fields; explicit **Check historical evidence** returned **No matching flight test**, 0 matching and 0 conditional records for the default 30% O2, 70.3kPa, lunar-gravity PMMA scenario; no UI crash.
- **Observed bug and fix:** the full 2D EvidenceMap clipped and overlapped its caption in the small WebGL fallback panel, especially on mobile. Replaced it with a much simpler `EvidenceFallback` SVG (259 solid-flight records with both O2 and P reported) and a scoped source/provenance caption. Updated screenshots were visually inspected at both viewports with no overlap.
- **Limitations:** Chromium here cannot create WebGL contexts even with SwiftShader. The true animated 3D scene and user drag/pick interactions were **not visually verified**. Real AWS, network routing, local storage, downloads, keyboard navigation and physical mobile GPU were not acceptance-tested through this mock transport. The current commit may have small additional CSS/text/meta updates beyond the inspected artifact; rerun screenshots after the actual final release.
- **Required production gate:** open the review preview on real Chrome/Edge desktop with WebGL enabled, verify slow orbit stops on manual drag and reduced-motion disables orbit; exercise keyboard flow, a 390px phone, and an incognito Evidence/Investigations/Protocol/Export sequence. Record actual browser console and network, then confirm post-merge AWS version marker. Do not claim that source-level CI validates these behaviors.

## Scientific and security limits
- Dataset is 1,678 normalized PSI records from 15 investigations; the 22.7% figure is the maximum reported oxygen in the 261-record **solid-material flight subset**. It is not a NASA-wide threshold, not a certification basis, and scenario markers are not performed tests.
- Legacy corpus-derived assumptions may require independent source review. Unit/lint/build success is not experimental validation or browser QA.
- Rotate any previously shared OpenRouter credential; no secrets in repository or browser bundle.
