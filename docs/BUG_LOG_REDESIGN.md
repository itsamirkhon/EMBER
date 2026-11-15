# Bug log — redesign session (2026-11-15)

Bugs found while redesigning the site. Each entry says whether this branch fixed it or left it for another agent.
Branch: `redesign/flight-plan`.

| # | Severity | Where | What | Status |
|---|---|---|---|---|
| 1 | **Blocker** | `ember-final/src/ui/v3/pages/HomePage.tsx` on `main` (77a28bb) | The merge of PR #4 and PR #5 spliced two versions of the file together: unclosed `<section>`/`<ol>`, a stray `))}`, and a reference to `apollo`, which is never defined. `npm run build` fails at `tsc`, so the GitHub Pages and AWS deploys from `main` cannot succeed. Vitest still passes because no test imports HomePage. | Fixed on this branch: restored the `6e079cc` version, then rewrote it during the redesign. |
| 2 | Build | `ember-final/src/ui/v3/pages/MapPage.tsx` on `main` | Unused `Term` import, another merge leftover. Fails `tsc` with `noUnusedLocals`. | Fixed on this branch. |
| 3 | CI gap | `.github/workflows/*` | CI ran `npm test` but the merge still landed broken, which suggests the merge commit's build was not required to pass before merging. | **Open**: make the `build` job a required check on `main`. |
