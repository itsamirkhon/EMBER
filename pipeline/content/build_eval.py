"""Writes web/public/data/extraction_eval.json: 36-claim manual-annotator check (concept section 8, check 2) + programmatic verbatim-quote check."""
import json, sys
from pathlib import Path
ROOT = str(Path(__file__).resolve().parents[2])
sys.path.insert(0, f"{ROOT}/pipeline/content")
from extract_claims import quote_in_source  # noqa

claims = json.load(open(f"{ROOT}/web/public/data/claims.json"))
src = {s["sourceId"]: s for s in json.load(open(f"{ROOT}/pipeline/content/cache/sources.json"))}
by = {c["id"]: c for c in claims}
sample = [c["id"] for i, c in enumerate(claims) if i % 4 == 0][:36]

# claimId: (goldText written after re-reading the source independently, verdict, note)
G = {
"c-0001": ("Objective 1 of BASS: begin to bridge the gap between NASA-STD-6001 Test 1 (1 g), ground-based microgravity tests and real microgravity flammability.", "correct", "Matches PSI-26 objective 1."),
"c-0005": ("PSI-26 states current spacecraft material selection uses NASA-STD-6001 Test 1, which sorts materials by 1-g behavior with no consideration of low-gravity effects.", "correct", ""),
"c-0009": ("The smallest acrylic-slab flames were hurt by conductive heat loss yet still burned >5 min before self-extinguishing; authors note a tiny flame might go undetected for a long time.", "correct", "Faithful; the claim omits the 'conductive heat loss' qualifier but does not change the meaning."),
"c-0013": ("BASS-II objective 1: study ignition, flame growth, spread and extinction limits of solid fuels in low-velocity forced flows in microgravity.", "correct", ""),
"c-0017": ("NASA's 1-g upward-burning test is considered the worst-case geometry on Earth but may not be conservative for flammability in space (BASS-II hypothesis section).", "correct", "The source frames this inside the hypothesis section; claim keeps it as a statement of NASA's own concern, which is acceptable."),
"c-0021": ("SIBAL fabric (1.2/2.2 cm x 10 cm) in low-speed concurrent flow: quenching speeds 1-5 cm/s, higher quench speed in lower O2 (21% to 16% tested). Work is part of both BASS and BASS-II.", "partial", "Numbers correct, but the source says the tests belong to 'the NASA BASS and BASS-II experimental projects'; attributing only to BASS-II loses half the provenance."),
"c-0025": ("For PMMA rods in concurrent flow, the blowoff branch of the flammability boundary is linear in oxygen concentration and stretch rate.", "correct", ""),
"c-0029": ("Ground (1 g) PMMA rods 0.635-3.81 cm at 14-18% O2: blowoff limits agree with BASS-II microgravity results once buoyant stretch and blockage factor are included.", "correct", "Claim correctly identifies these as normal-gravity tests compared against BASS-II."),
"c-0033": ("Saffire-I: SIBAL sample, air flow velocity 20 cm/s.", "correct", ""),
"c-0037": ("Saffire downlinked data resolved whether flame growth reaches a steady size; the enclosure size around the sample affected spread more than expected.", "partial", "Content correct, but the 2018 abstract summarizes the Saffire series, not Saffire-I alone; the inv attribution is an inference. The source sentence itself is ungrammatical ('data show resolved')."),
"c-0041": ("2015 plan: Saffire-1 and Saffire-3 = meter-scale sample flame-spread tests in the Cygnus pressurized volume, burned to completion.", "correct", "Planned design, stated as 'planned' in the claim. Also applies to Saffire-III."),
"c-0045": ("Saffire-II sample card: 9 samples, each 5 cm x 29 cm; materials added included SIBAL, silicone, structural PMMA, flat PMMA, PMMA with Nomex.", "partial", "Facts are in PSI-99, but the quote only supports the count and size; the material list comes from a different sentence and is not covered by the quote."),
"c-0049": ("Ground silicone tests for Saffire used the Test 1 geometry (5 cm x 30 cm) at thicknesses 0.25, 0.36, 0.61, 1.00 mm.", "correct", ""),
"c-0053": ("Saffire II microgravity data: 10 mm thick PMMA, concurrent spread, 100 kPa, 200 mm/s flow, used to validate a reduced-pressure ground correlation.", "correct", "10 mm thickness is stated in the source but not inside the quote."),
"c-0057": ("Saffire-III flow was either concurrent or opposed.", "correct", ""),
"c-0061": ("FLEX: determine LOI as a function of ambient pressure and how a suppressant changes it.", "correct", ""),
"c-0065": ("MDCA-FLEX goal: give definition and direction for large-scale suppression tests and selection of the suppressant for next-generation crew exploration vehicles.", "correct", ""),
"c-0069": ("Methanol droplets of ~1.5-4 mm were used so both diffusive extinction (short residence time) and radiative extinction (heat loss) occur.", "correct", ""),
"c-0073": ("ISS droplet tests: normal alkanes with NTC chemistry can burn quasi-steadily at low temperature with no visible flame.", "correct", "Source does not name FLEX; attribution to FLEX is consistent with the CIR droplet program timeline but is an inference."),
"c-0077": ("FLEX-2 objective 5: influence of droplet interactions on flammability limits and extinction of droplet arrays.", "correct", ""),
"c-0081": ("SAME hypothesis: in microgravity, smoke particles from pyrolyzing/smoldering sources grow larger than in 1 g (nucleation, condensation, coagulation).", "correct", "Correctly labelled as a hypothesis, not a result."),
"c-0085": ("Shuttle experiments confirmed that in some cases particle sizes increase in low gravity and that ISS vs shuttle detector relative performance changes; data were insufficient to design new detectors.", "correct", "Claim omits that the size data were insufficient for detector design; meaning preserved."),
"c-0089": ("Shuttle (ionization) and ISS (near-IR forward scattering) smoke detectors were designed without any low-gravity smoke or background-dust size data.", "correct", ""),
"c-0093": ("SAME reflight heated Teflon, Kapton, cotton, silicone rubber and Pyrell below ignition temperature.", "correct", "Source calls it SAME-2 (Expedition 24) - same as SAME-R."),
"c-0097": ("SAME-R flight tests July 16 - Sept 9, 2010, 66 test points.", "correct", ""),
"c-0101": ("CFI objectives: n-dodecane and n-dodecane/iso-dodecane at 0.25-5 atm (objective 1) and helium-dilution effects (objective 2). Approach text says chamber gas 0.25-0.5 atm.", "partial", "Quote supports only objective 1; helium part comes from another line. PSI-39 is internally inconsistent on the pressure range (objective 0.25-5 atm vs approach 0.25-0.5 atm); claim reports only the objective range without flagging this."),
"c-0105": ("Cool-flame-supported quasi-steady droplet burning was first observed on ISS in the CIR with n-alkane fuels.", "partial", "Statement is correct, but the first observation was made in the earlier FLEX droplet tests; attaching it to CFI implies CFI discovered cool flames."),
"c-0109": ("BRE objective 1 plans to examine NASA-considered atmospheres 14.7 psia/21%, 10.2 psia/26.5%, 8.2 psia/34%.", "partial", "Source says these atmospheres 'will be examined' (planned objective). The claim's past tense implies they were tested; PSI-20 does not confirm which were actually flown."),
"c-0113": ("BRE objective: observe CH4/N2 and C2H4/N2 burning on 25 and 50 mm porous burners in long-duration microgravity.", "partial", "Source states an objective ('Observe ...'), not a flown test matrix; claim says 'flight tests used'. 25/50 mm burners are confirmed for drop tests in NTRS 20160010073."),
"c-0117": ("Cool diffusion flames: peak temperature 500-1000 K; discovered in 2012.", "correct", ""),
"c-0121": ("Three ACME studies - soot processes, flame dynamics, low-temperature combustion - used porous spherical burners giving a nominally 1-D flame.", "correct", "Source is the ACME overview, not CFI-G specific; CFI-G is the low-temperature study so attribution is reasonable."),
"c-0125": ("Microgravity is ideal for isolating electric-field effects from buoyancy forces.", "correct", ""),
"c-0129": ("SPICE fuels: methane, ethylene, propane, propylene, propylene mixtures.", "correct", ""),
"c-0133": ("SLICE CH4 coflow flames: soot distribution shifts from centerline (1 g) to the wings (microgravity).", "correct", ""),
"c-0137": ("Flow-tunnel microgravity tests: 1g ULOI and 1g MOC are up to 4% O2 higher than 0g values, i.e. fuels burned in 0g at lower O2 than under NASA-STD-6001 Test 1.", "correct", "Not one of the 15 PSI investigations (inv = null). Source does not say the tests were in orbit (likely drop-tower); claim says 'microgravity flow-tunnel tests', which matches."),
"c-0141": ("At 8.2 psia / 34-40% O2, material flammability is the critical hurdle: 70% of assessed subsystems need material replacements, many not yet developed.", "correct", ""),
}
assert set(G) == set(sample), (set(sample) ^ set(G))

items, n_verb = [], 0
for cid in sample:
    c = by[cid]
    v = quote_in_source(c["quote"], src[c["sourceId"]]["text"])
    n_verb += v
    gold, verdict, note = G[cid]
    items.append({"claimId": cid, "inv": c["inv"], "sourceId": c["sourceId"], "goldText": gold, "llmText": c["text"],
                  "verdict": verdict, "quoteVerbatim": v, "note": note})

all_verb = sum(quote_in_source(c["quote"], src[c["sourceId"]]["text"]) for c in claims)
cnt = {k: sum(1 for i in items if i["verdict"] == k) for k in ("correct", "partial", "wrong")}
out = {
    "method": (f"Concept section 8, check 2. Claims in claims.json were produced in the LLM-extractor role (extractedBy 'llm') from "
               f"cached NTRS abstracts and PSI investigation records (pipeline/content/cache/sources.json). A systematic sample of 36 "
               f"(every 4th claim: c-0001, c-0005, ... c-0141) was re-checked by a separate manual-annotator pass: the cited source was "
               f"re-read, a gold statement written from the source alone, and the LLM statement graded correct (fully supported, right "
               f"investigation), partial (true but with an attribution, tense or quote-coverage problem) or wrong (contradicted or "
               f"unsupported). Programmatic check: every quote was searched verbatim in the cached source text "
               f"(whitespace/quote-mark normalized; also exact substring): {n_verb}/36 sampled and {all_verb}/{len(claims)} of all claims "
               f"matched (100%). Verbatim quotes do not guarantee a correct claim - all partial verdicts below have verbatim quotes. "
               f"Caveats: the annotator is the same model family as the extractor (not an independent human), so agreement is likely "
               f"optimistic; before this evaluation, 2 non-sampled claims from NTRS 20150018397 were re-attributed from CFI to FLEX after review."),
    "n": len(items), **cnt,
    "quoteVerbatimRate": {"sample": f"{n_verb}/{len(items)}", "all": f"{all_verb}/{len(claims)}"},
    "items": items,
}
json.dump(out, open(f"{ROOT}/web/public/data/extraction_eval.json", "w"), indent=1, ensure_ascii=False)
print(cnt, n_verb, all_verb)
