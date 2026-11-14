# EMBER presentation add-on

Dated handoff: **14 November 2026**. Designed against `itsamirkhon/EMBER` commit
`81b52936326fb22ba1c1249160404c5455d36a80`.

## Open the result

`web/public/EMBER_Presentation.html` is a self-contained document. Open it in a
WebGL-enabled browser. No CDN, external fonts, npm installation or backend is
required to use its built-in presentation and offline source excerpt.

The file uses **native WebGL**, not Three.js. Its procedural flame volume and
conceptual chamber are 3D; they are not crossed flame sprites. This removes the
external-module/import-map failure in the earlier standalone concept.

The page has four chapters: Observe, Intervene, Trace and Question. Present starts
an explicit guided tour. Motion controls, camera orbit, zoom, atmospheric controls,
source inspection and evidence export are available independently.

## Add it to the team's existing site

Copy the `web/`, `tools/`, `tests/` and `docs/` overlay into the repository root.
Alternatively, use the supplied patch on a clean feature branch:

```sh
git switch -c feat/ember-presentation
git apply --check /path/to/EMBER_presentation.patch
git apply /path/to/EMBER_presentation.patch
node --test tests/presentation/support.test.cjs
python3 tools/ember-presentation/build.py
cd web
npm run build
```

Vite copies the new page from `public` without altering the existing routes. Open
`/EMBER_Presentation.html` on the dev server, or
`/EMBER/EMBER_Presentation.html` when hosted under the repository's Pages base.
Add a navigation link from the main app when the team is ready. No existing
engine, component, route, raw data file or deployment workflow is overwritten.

When served over HTTP(S), the page attempts to fetch **relative, same-origin**
`./data/tests.json`. This matches the current `web/public/data/tests.json`
location. The full data is **not embedded** in the standalone download. Failed
HTTP requests, malformed JSON and invalid schemas preserve the clearly labelled
14-row offline excerpt. The drawer also accepts manual `tests.json` import.

## What is connected, and what is not

- The page accepts the team's existing `TestRow[]` data format, including source
  file and row locators. It can inspect that dataset and export a source audit.
- `web/public/ember/support.js` provides a conservative, additive evidence gate.
  It does not replace or modify `web/src/lib/evidence.ts`.
- The page does **not** call the upstream nearest-neighbour predictor. It calls
  its own support check over the source records. Use `gateEstimate(query, result)`
  only when explicitly wiring the original estimator to another UI.
- No fire-risk percentage, validated flame reconstruction, suppressant dose or
  operational ventilation recommendation is produced here.
- The flame's shape, optical color, metal and glass are illustrations. The scene
  is not CFD, a NASA hardware replica, or a reconstruction of the listed BASS-II
  test. The first two chapters use a wick analogy; later chapters show a schematic
  plate. Material selectors affect evidence matching, not calibrated kinetics.

## Mobile behavior

320 px through tablet widths were checked, plus landscape. The phone layout has
a compact headline, a large viewport, 44-pixel-or-larger primary controls,
vertically arranged sliders, fixed chapter navigation, safe-area padding,
full-width evidence drawer, one-finger orbit, two-finger pinch zoom and reset.

Reduced-motion preferences start the animation paused. Off-screen or hidden
scenes and scenes behind the open evidence panel do not keep rendering. Coarse
pointer devices cap redraw requests to approximately 30 Hz; this is not a claim
of measured device performance. No sideways page scrolling was found in the
checked viewports.

## Scientific safeguards and issues found upstream

The inspected upstream `withinTolerance` tests oxygen, pressure, flow, phase and
fuel, but not gravity. Turning on its `gravityAware` distance option does not
add gravity to that measured-status check. A partial-gravity query can therefore
receive a misleading measured label when other fields match.

Other review concerns: axis-by-axis bracketing is not a validated multivariate
interpolator; "completed" and "disruption" are not universal physical burn/safe
labels; a weighted neighbour vote is not automatically a calibrated probability.
These are code-review observations, not an independently rerun scientific
backtest of the upstream corpus.

The added support gate requires explicit phase, material, geometry, requested
specimen dimensions, gravity, atmosphere, outcome and row-level provenance.
It does not transfer across gravity regimes or invent missing source conditions.
An exact complete source observation is labelled `observed`, not "safe". A nearby
record is `nearby`, not validated interpolation. Unsupported queries remain
`unsupported`. No statistical confidence number is synthesized.

## Checks actually run

- 36 Node support-gate unit tests, including gravity mismatch and missing data.
- 31 desktop browser checks: rendering, moving pixels, pause, mouse orbit/zoom,
  chapters, sliders, source drawer, JSON export and imports.
- 47 responsive/touch checks: 320, 390, 430, 768 px and 844 px landscape, including
  actual Chromium CDP touch events for one-finger orbit and two-finger pinch.
- 9 loader/fallback checks: no-GPU message, usable source UI, HTML escaping,
  relative URL resolution, same-origin credentials and data-preserving failures.

Reports are in `docs/ember-presentation/qa`. Browser checks used Chromium with
ANGLE SwiftShader under Xvfb. **Not tested on physical iPhones/Android phones or
Safari.** They prove software behavior in emulation, not broad device performance.
File/localhost navigation was restricted in this environment; the standalone
HTML was loaded into a browser document and external requests were blocked.
The same-origin fetch was contract-tested using mocked responses, not against
Amirkhon's live ngrok deployment or the complete production dataset.

## Rebuild and retest

```sh
python3 tools/ember-presentation/build.py
node --test tests/presentation/support.test.cjs
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/presentation/browser_test.py
python3 tests/presentation/mobile_check.py
python3 tests/presentation/loader_check.py
```

Set `CHROMIUM_PATH` to use an existing Chromium executable. On Linux without a
working display/GPU service, use `xvfb-run -a` before each browser-test command.
Generated artifacts stay in `tests/presentation/artifacts/`.

## Source provenance

1. Team raw table: `data/raw/PSI-25/PSI-25_Experimental table_BASS-II.csv`, blob
   `7e1d36d2381eb9bd02b758aa35c6167f14c25294`, at the pinned commit above.
2. NASA BASS-II: https://psi.nasa.gov/physci/repo/data/investigations/PSI-25
3. NASA candle analogy: https://www.nasa.gov/image-article/candle-flame-1g-vs-microgravity/
4. NASA soot exception: https://www.nasa.gov/image-article/studying-flames-microgravity/
5. Three.js module setup reference: https://threejs.org/manual/pages/installation.html

The 14-row excerpt contains PMMA-labelled rows from the retrieved beginning of
the raw table. Pressure, calibrated airflow and physical outcomes were not
available in that excerpt and remain null/unknown. Microgravity is an
investigation-level attribution, documented in the snapshot, not a value read
from an absent CSV gravity column. Source data is NASA PSI CC0; code follows the
EMBER repository's GPL-3.0 license.

## Delivery status

The presentation and tests are implemented and tested as described above. A
local additive commit and patch are provided. **Nothing has been pushed, merged,
or deployed.** The available GitHub actions here only exposed reads; they did not
provide a commit/push operation. Amirkhon's ngrok URL could not be reached from
this environment. Keep this add-on on a feature branch while the team continues
working on the main app and engine.
