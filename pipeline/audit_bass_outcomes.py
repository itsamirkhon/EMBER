#!/usr/bin/env python3
"""Measure the error of the BASS keyword-rule outcomes against a manual reading of the notes.

BASS outcomes are parsed by keyword rules from the free-text 'Test Observations' column of the
As-Run test matrix (the BASS final report is unavailable, and the As-Run matrix has no structured
result column). This script draws a fixed random sample of 30 BASS rows (seed 2026), and compares
the rule's burn / no-burn answer with a reading of the full observation text recorded in MANUAL below.

Output: web/public/data/outcome_audit.json (shown on the Trust page).

    python3 pipeline/audit_bass_outcomes.py
"""
import json
import random
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
SEED, N = 2026, 30

BURN = {"burned", "flame_spread", "completed", "disruption"}
NOBURN = {"extinguished", "self_extinguished", "no_ignition"}

# Manual reading of the full observation text, judged by the contract's rule: the outcome describes the
# row's initial O2/flow (flame established and sustained -> burn; brief flame only or no ignition -> noburn);
# how the test ended is extra.terminalEvent. None = the notes do not allow a burn / no-burn answer.
# (manual binary, note)
MANUAL: dict[str, tuple[str | None, str]] = {
    "BASS-16-55": ("burn", "dim blue flame sustained until the fan was turned off"),
    "BASS-40-67": (None, "igniter broken, no test"),
    "BASS-64-118": (None, "igniter broken, no test"),
    "BASS-65-11": ("burn", "'nice burn', flame reached a steady size"),
    "BASS-82-114": ("burn", "'wake ign' and flow stepped 7.5 -> 2 cm/s imply a sustained flame, but the notes never say so explicitly"),
    "BASS-106-52": ("burn", "all-blue flame with soot streaks"),
    "BASS-14-12": ("noburn", "burned 2 s, died when the igniter was turned off"),
    "BASS-109-107": ("burn", "ignition in 1.5 min, dim flame visible"),
    "BASS-28-49": ("burn", "flame for ~3 min at 9 cm/s, out only when flow shut off"),
    "BASS-76-70": ("burn", "stable flame, slow downstream spread"),
    "BASS-79-75": ("noburn", "went out when the igniter was retracted, twice"),
    "BASS-71-84a": ("burn", "candle burned ~10 min"),
    "BASS-53-113": ("burn", "bright sooty flame, later blown out with N2"),
    "BASS-96-72": ("noburn", "repeated ignitions, flame never sustained"),
    "BASS-73-86a": ("burn", "candle burning, out when flow stepped to 0"),
    "BASS-70-83c": ("burn", "candle burned out all wax"),
    "BASS-89-87": ("burn", "long candle burn at low flow"),
    "BASS-95-40": ("burn", "lit on 2nd try, spread around the sphere"),
    "BASS-94-39": ("burn", "blue flame after 3 min of attempts; out only after fan reduced"),
    "BASS-62-64": ("burn", "flame blown out by N2, so it was burning"),
    "BASS-92-105": ("burn", "ignited in 1 min, symmetric growth"),
    "BASS-98-118": ("burn", "burned on the forward stagnation region, minimal spread"),
    "BASS-75-86c": ("burn", "candle ran out of fuel"),
    "BASS-56-15": ("noburn", "did not ignite, igniter on the whole test"),
    "BASS-30-23": ("burn", "sooty bullet-shaped flame, out when fan off"),
    "BASS-1-1": ("burn", "steady spreading"),
    "BASS-78-74": ("burn", "ignited nicely, sooty flame"),
    "BASS-11-21": ("burn", "burning laminar, very fast burning rate"),
    "BASS-15-54": ("burn", "dim blue flame spreading upwind"),
    "BASS-36-61": ("burn", "flame spread on the top side, out with flow off"),
}
# Where the rule's finer category differs from the reading although burn / no-burn agrees.
SUBTYPE_NOTES = {
    "BASS-70-83c": "rule says flame_spread; a candle burning down is 'burned'",
    "BASS-98-118": "rule says flame_spread; notes say 'minimal spread', 'burned' fits better",
}


def binary(outcome: str) -> str | None:
    return "burn" if outcome in BURN else "noburn" if outcome in NOBURN else None


def main() -> None:
    rows = [r for r in json.loads((DATA / "tests.json").read_text()) if r["inv"] == "BASS"]
    sample = random.Random(SEED).sample(rows, N)
    missing = [r["testId"] for r in sample if r["testId"] not in MANUAL]
    if missing:
        raise SystemExit(f"sample changed; read and add manual verdicts for: {missing}")

    items, counts = [], {"agree": 0, "wrong": 0, "missed": 0, "falseAnswer": 0}
    for r in sample:
        manual, note = MANUAL[r["testId"]]
        rule = binary(r["outcome"])
        if rule == manual:
            verdict = "agree"
        elif rule is None:
            verdict = "missed"  # rule abstained although the notes allow an answer
        elif manual is None:
            verdict = "falseAnswer"  # rule answered although the notes do not allow one
        else:
            verdict = "wrong"
        counts[verdict] += 1
        items.append({
            "testId": r["testId"], "fuel": r["fuel"], "ruleOutcome": r["outcome"], "ruleBinary": rule,
            "manualBinary": manual, "verdict": verdict, "note": note, "subtypeNote": SUBTYPE_NOTES.get(r["testId"]),
            "observations": r["extra"].get("observations"),
        })

    answered = sum(1 for i in items if i["ruleBinary"] is not None)
    audit = {
        "generatedAt": date.today().isoformat(),
        "inv": "BASS",
        "method": (
            f"{N} BASS rows drawn at random (Python random.Random({SEED}).sample over all {len(rows)} rows). "
            "The full 'Test Observations' text of each row was read and given a burn / no-burn answer for the row's "
            "initial conditions (or none when the notes do not allow one), then compared with the keyword rule. "
            "The reading was done by an AI assistant (Claude), the same model family that wrote the rules, not by "
            "an independent human annotator."
        ),
        "n": N,
        "ruleAnswered": answered,
        **counts,
        "subtypeDisagreements": len(SUBTYPE_NOTES),
        "items": items,
    }
    (DATA / "outcome_audit.json").write_text(json.dumps(audit, indent=1, ensure_ascii=False))
    print(f"BASS outcome audit: {counts} of {N}; rule answered {answered}; -> {DATA / 'outcome_audit.json'}")


if __name__ == "__main__":
    main()
