# EMBER data pipeline

Turns NASA PSI (Physical Sciences Informatics) combustion records into the JSON files defined in `docs/DATA_CONTRACT.md`.

```
python3 pipeline/fetch_psi.py          # download metadata + test tables -> data/raw/  (idempotent, --force to refresh)
python3 pipeline/fetch_psi.py --ntrs   # also refresh NTRS search results / citation records
python3 pipeline/build_dataset.py      # normalize -> web/public/data/{tests,investigations,datasets_manifest}.json
```

Requirements: Python 3.10+, `requests`, `openpyxl`. `--tm` (optional) also needs `pdftotext`.
`build_dataset.py` works offline from `data/raw/`. It validates its own output and exits non-zero on failure (unknown `inv`, duplicate `testId`, non-numeric or implausible values, outcome outside the enum, keyFinding without a source).

## How PSI is accessed

The PSI site (`https://psi.nasa.gov/physci/repo/...`) is an Angular single-page app. Its bundle (`main.*.js`) calls a public JSON API:

| Purpose | Endpoint |
|---|---|
| Full investigation record (title, DOI, objective, hypothesis, approach, impacts, publications, `experimentalTable[]`, `added[]` = all files) | `GET https://psi.nasa.gov/geode-py/ws/repo/investigations/PSI-NN` |
| Presigned S3 link for one file | `GET https://psi.nasa.gov/geode-py/ws/studies/PSI-NN/download?file=<file_name>&redirect=false` (the response body is the URL) |
| Search | `GET https://psi.nasa.gov/geode-py/ws/repo/search?q=...` |

No login is needed for public (CC0-1.0) records. Videos and raw binaries are skipped. Only the PSI "Experimental table" CSVs and a few small science-document spreadsheets are downloaded.

## Files

- `fetch_psi.py`: downloads `investigation.json` + tables per PSI id into `data/raw/PSI-NN/`, and NTRS search/citation JSON into `data/raw/PSI-NN/ntrs_search.json` and `data/raw/ntrs/`. Writes `data/raw/fetch_log.json` with sha256 checksums.
- `build_dataset.py`: one parser per investigation, plus card assembly, the manifest and validation.
- `cards.py`: hand-written card text (objective, fuel, varied/constant, diagnostics, summary, key findings). Every finding cites a `sourceId` (PSI page or NTRS record). Condition ranges and `nTests` are **computed** from tests.json where rows exist.

## Investigations and sources (PSI numbers and DOIs verified against the PSI API, 2026-11-14)

| id | PSI | DOI | row source | rows |
|---|---|---|---|---|
| BASS-II | PSI-25 | 10.60555/4qc4-de67 | Experimental table CSV | 129 |
| BASS | PSI-26 | 10.60555/58h4-dy80 | Experimental table CSV + *As Run Test Matrix.xlsx* (O2, pressure, flow, observations) | 121 |
| Saffire-I | PSI-98 | 10.60555/0t15-1z43 | CSV | 2 |
| Saffire-II | PSI-99 | 10.60555/2chp-m469 | CSV | 9 |
| Saffire-III | PSI-100 | 10.60555/040q-4h36 | CSV | 2 |
| FLEX | PSI-69 | 10.60555/mbq8-0451 | CSV | 274 |
| FLEX-2 | PSI-68 | 10.60555/byp8-h018 | planned matrix only, no rows emitted | 0 |
| CFI | PSI-39 | 10.60555/m6pj-a914 | CSV + *CFI_DataSummary_Spreadsheet* (D0, k, extinction diameters) | 79 |
| SAME | PSI-102 | 10.60555/gd4k-8h62 | CSV (condition summary) | 8 |
| SAME-R | PSI-101 | 10.60555/2np7-jv14 | CSV | 109 |
| ACME-BRE | PSI-20 | 10.60555/vb93-3y72 | CSV (test-day x O2 summary) | 43 |
| ACME-CFI-G | PSI-159 | 10.60555/cyt1-kh64 | Normal + Inverse flame CSVs | 333 |
| ACME-E-FIELD | PSI-22 | 10.60555/se5a-8c73 | CSV (test-day x fuel summary) | 32 |
| SPICE | PSI-107 | 10.60555/9kbh-e962 | CSV | 469 |
| SLICE | PSI-106 | 10.60555/pm12-rg61 | CSV (test days only) | 12 |

## Normalization

O2 → % by volume (mole fractions x100), pressure → kPa (atm x101.325, mmHg x0.13332, bar x100), flow → cm/s, spread rate → mm/s, droplet burning-rate constant → mm²/s, diameters/thickness → mm (inches x25.4). Source columns that don't map to a contract field stay verbatim in `extra`. `source.row` is the spreadsheet row number (header = row 1).

Outcome mapping (the original wording is always kept in `outcomeRaw`):
- FLEX: Extinction → `extinguished`, Disruption → `disruption`, Completion → `completed`.
- ACME-CFI-G: Hot ignition No → `no_ignition`; flash or Yes+SE → `self_extinguished`; Yes+FT (flow terminated while burning) → `burned`.
- CFI: a hot-flame extinction diameter → `extinguished` (a cool flame may continue).
- Saffire: a reported burn time → `burned`; "Insignificant" → `self_extinguished`.
- BASS / BASS-II: keyword rules on free text (observations, fan/air display). These outcomes are indicative only and are flagged in `extra.outcomeDerivedFrom`.
- Smoke tests (SAME, SAME-R) and tables without results (SPICE, SLICE, Saffire-III) → `unknown`.

## Known caveats (also in each card's `dataNotes`)

- **FLEX**: the column is labelled "Burning rate; mm" but the values are K in mm²/s. Gas columns "O/N/CO/He" are O2/N2/CO2/He. One row has pressure 0 mmHg (set to null). The PSI table has 274 rows; NASA/TP-20150023456 reports 284 tests.
- **BASS-II**: no spread-rate, pressure or outcome columns. Flow is the first "Air display" value, and the flow was stepped during each test. The per-test observation text exists only in the TM-20210011385 PDF appendix (text dump in `data/raw/ntrs/`, not parsed yet).
- **BASS**: the PSI table holds only test IDs and materials. Conditions come from the As-Run xlsx.
- **Saffire**: the thickness unit is doubtful (cm vs mm), so it is left null for I/III. Saffire-III has no O2 or results. Spread rate exists only for Saffire-II SIBAL (2.1 and 2.6 mm/s).
- **FLEX-2**: PSI has only the planned matrix. Card conditions are the planned ranges.
- **CFI**: the PSI table repeats 8 rows verbatim (dropped).
- **ACME-CFI-G** inverse flames: `o2Pct` is the oxidizer-stream O2 (up to 85 %), not the ambient atmosphere.
- **ACME-BRE / E-FIELD / SLICE** rows are test-day summaries, not individual tests (`extra.granularity`).
- **SAME / SAME-R**: there are no particle sizes per row. SAME-R results (200–400 nm typical) are in the card only.
