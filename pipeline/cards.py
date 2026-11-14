"""Hand-curated investigation card text for EMBER.

Every statement here is paraphrased from (and cites) either the PSI investigation
record (data/raw/PSI-NN/investigation.json: objective / hypothesis / approach /
researchImpacts) or an NTRS record (data/raw/ntrs/<id>.json abstract).
Numeric conditions are NOT written here when test rows exist: build_dataset.py
computes them from tests.json. Values given here are only fallbacks for
investigations without per-test rows, and are labelled in dataNotes.
"""


def ntrs(i, label, typ="ntrs"):
    return {"id": f"ntrs-{i}", "label": label, "url": f"https://ntrs.nasa.gov/citations/{i}", "type": typ}


def psi(n):
    return {"id": f"psi-{n}", "label": f"PSI-{n} investigation page (NASA PSI)",
            "url": f"https://psi.nasa.gov/physci/repo/data/investigations/PSI-{n}", "type": "psi"}


def paper(doi, label):
    return {"id": f"doi-{doi}", "label": label, "url": f"https://doi.org/{doi}", "type": "paper"}


CARDS = [
    # ------------------------------------------------------------------ MSG / BASS flow duct
    {
        "id": "BASS-II", "name": "Burning and Suppression of Solids – II", "psi": "PSI-25", "doi": "10.60555/4qc4-de67",
        "family": "MSG-SPICE", "hardware": "Microgravity Science Glovebox (MSG), BASS small flow duct (wind tunnel)",
        "platform": "ISS", "fuelPhase": "solid", "direction": ["prevention", "suppression"], "safetyConsequence": 3,
        "objective": "Study ignition, flame growth, flame spread and extinction limits of solid fuels in low-velocity forced flow in microgravity, "
                     "and begin to bridge the gap between the 1-g NASA-STD-6001 Test 1 and real material flammability in microgravity.",
        "fuel": {"types": ["PMMA", "SIBAL (75/25 cotton/fiberglass fabric)", "Nomex III", "Japan wax candle"],
                 "geometry": "thin PMMA films, PMMA slabs (one- and two-sided), PMMA rods, PMMA spherical section, fabric strips",
                 "size": "films 0.1–0.4 mm thick, slabs 1–5 mm thick, 1–2 cm wide; rods 1/4–1/2 in (6.35–12.7 mm) diameter"},
        "varied": ["forced flow velocity (speed and direction)", "ambient O2 concentration (N2 vitiation of the MSG working volume)",
                   "sample geometry and thickness"],
        "constant": ["pressure ~1 atm (MSG working volume; stated in NASA/TM-20210011385, not measured per test)", "microgravity"],
        "diagnostics": ["video camera with data overlay (fan, flow, radiometer)", "digital still camera (Nikon)", "radiometer (uncalibrated, relative)",
                        "CSA-CP O2 and CO sensor", "Carbon Dioxide Monitor (CDM)"],
        "resultSummary": "About 130 flame tests on PMMA films, slabs, rods, fabrics and a candle in a small wind tunnel on the ISS, with O2 reduced "
                         "below 21 % by nitrogen dilution. Flames were very sensitive to air flow between 0 and 5 cm/s and could survive at "
                         "flows below 1 cm/s as dim blue flames that flare up when flow increases. Measured heat-release rates were mostly below 100 W.",
        "keyFindings": [
            {"text": "Flames are quite sensitive to air flow speed in the range 0–5 cm/s and can be sustained at speeds below 1 cm/s, where they become dim, blue and stable; they can flare up quickly if the air flow suddenly increases.", "sourceId": "ntrs-20160000593"},
            {"text": "BASS-II was the first ISS test to dilute the MSG working volume with N2, adding ambient O2 as a controlled variable.", "sourceId": "ntrs-20210011385"},
            {"text": "Heat-release rates computed from O2 consumption were well below 100 W for most tests; the global equivalence ratio was fuel-rich (about 1.3 on average).", "sourceId": "ntrs-20210011385"},
            {"text": "Hypothesis tested: with adequate ventilation, materials in microgravity burn as well as or better than in normal gravity, so the 1-g upward-burning test may not be conservative for space.", "sourceId": "psi-25"},
        ],
        "flight": True, "years": "2014–2016 (test dates in PSI table)",
        "earthRelevance": "Validated combustion models apply to wildfires, building fires and waste-to-energy combustion (PSI research impacts).",
        "sources": [psi(25),
                    ntrs("20210011385", "NASA/TM-20210011385: BASS-II Summary Report (2021)"),
                    ntrs("20160000593", "Combustion of Solids in Microgravity: Results from the BASS-II Experiment (2014)"),
                    ntrs("20150019858", "Results from On-Board CSA-CP and CDM Sensor Readings During BASS-II (2015)"),
                    paper("10.1016/j.combustflame.2017.03.001", "Olson & Ferkul, Microgravity flammability boundary for PMMA rods in axial stagnation flow, Combust. Flame 2017")],
    },
    {
        "id": "BASS", "name": "Burning and Suppression of Solids", "psi": "PSI-26", "doi": "10.60555/58h4-dy80",
        "family": "MSG-SPICE", "hardware": "Microgravity Science Glovebox (MSG), BASS flow duct (76 x 76 mm cross-section) with N2 suppression jet",
        "platform": "ISS", "fuelPhase": "solid", "direction": ["prevention", "suppression"], "safetyConsequence": 3,
        "objective": "Bridge the gap between the 1-g NASA-STD-6001 Test 1, ground-based microgravity tests and real material flammability in microgravity, "
                     "and assess how well an inert gaseous extinguishing agent (N2, similar to that used on ISS) puts out flames.",
        "fuel": {"types": ["SIBAL (75/25 cotton/fiberglass fabric)", "PMMA", "Nomex", "Ultem", "paraffin / Japan wax"],
                 "geometry": "fabric strips, PMMA spheres and slabs, sheets, candles and wax slabs",
                 "size": "1–2 cm wide fabric strips; 1 and 2 cm PMMA spheres"},
        "varied": ["air flow speed (up to ~40 cm/s)", "flow direction (opposed / concurrent)", "material and geometry", "fuel preheating",
                   "N2 jet for suppression", "ambient O2 (some 2013 tests vitiated with N2)"],
        "constant": ["ISS cabin pressure (~0.97–1.0 atm per as-run matrix)", "microgravity"],
        "diagnostics": ["video camera with data overlay", "digital still camera", "radiometer", "ISS O2 / pressure / CO2 readings"],
        "resultSummary": "Over a hundred small-scale ISS tests burned fabrics, PMMA spheres and slabs and candles in a low-speed air flow, "
                         "sometimes followed by an N2 jet to try to extinguish them. Flames were especially sensitive to flow in the 0–5 cm/s range; "
                         "at the lowest flows they became dim and blue but could keep burning for a long time.",
        "keyFindings": [
            {"text": "Microgravity flames were especially sensitive to air flow speed in the range 0–5 cm/s, and responded to flow changes with almost no delay.", "sourceId": "ntrs-20140011099"},
            {"text": "Even the smallest acrylic-slab flames burned for over 5 minutes before self-extinguishing — a tiny flame could go undetected for a long time and flare up if convection increases.", "sourceId": "ntrs-20140011099"},
            {"text": "Using N2 as a flame suppressant in microgravity provides a direct link to current and planned ISS extinguishment techniques.", "sourceId": "psi-26"},
        ],
        "flight": True, "years": "2012–2013 (test dates in PSI table)",
        "earthRelevance": "Microgravity-validated combustion models feed back into terrestrial fire models (PSI research impacts).",
        "sources": [psi(26),
                    ntrs("20140011099", "Thickness and Fuel Preheating Effects on Material Flammability in Microgravity from the BASS Experiment (2013)")],
    },
    # ------------------------------------------------------------------ Saffire (Cygnus)
    {
        "id": "Saffire-I", "name": "Spacecraft Fire Safety Experiment – I", "psi": "PSI-98", "doi": "10.60555/0t15-1z43",
        "family": "Saffire-Cygnus", "hardware": "Saffire-I flow duct in the Cygnus cargo vehicle (after unberthing from ISS)",
        "platform": "Cygnus", "fuelPhase": "solid", "direction": ["prevention"], "safetyConsequence": 3,
        "objective": "Determine how rapidly a large-scale fire grows in low gravity and compare low-g flammability limits with NASA's 1-g material screening test.",
        "fuel": {"types": ["SIBAL (75/25 cotton/fiberglass fabric)"], "geometry": "single large fabric sheet in a flow duct",
                 "size": "approx. 94 cm x 40.6 cm"},
        "varied": ["flow direction (concurrent vs opposed)"],
        "constant": ["air flow ~20 cm/s", "material (SIBAL)", "Cygnus cabin atmosphere"],
        "diagnostics": ["2 cameras", "thermocouples (flow, flame, plume temperature)", "2 radiometers", "pressure, O2 and CO2 sensors", "2 anemometers"],
        "resultSummary": "The first intentionally large fire set inside an orbiting spacecraft: a 94 x 40.6 cm cotton-fiberglass sheet burned in a 20 cm/s air flow, "
                         "once with and once against the flow. In concurrent spread the flame size stayed limited after ignition, unlike the accelerating upward fire seen on Earth.",
        "keyFindings": [
            {"text": "The 94 x 40.6 cm sample was an order of magnitude larger than anything previously burned in microgravity.", "sourceId": "ntrs-20170008805"},
            {"text": "In concurrent spread the flame size remained constrained after ignition — qualitatively different from Earth, where an upward-spreading flame on a sample this size accelerates and grows.", "sourceId": "ntrs-20170008805"},
            {"text": "The flame in the large Saffire duct spread more slowly than in earlier small-tunnel microgravity tests, attributed to flow acceleration by hot-gas expansion in small tunnels — scale matters.", "sourceId": "ntrs-20170008805"},
        ],
        "flight": True, "years": None,
        "earthRelevance": "Fire behaviour in small sealed volumes informs fire safety in mines, aircraft and submarines (PSI research impacts).",
        "sources": [psi(98),
                    ntrs("20170008805", "Results of Large-Scale Spacecraft Flammability Tests (2017)"),
                    ntrs("20170001636", "The Spacecraft Fire Experiment (Saffire) – Objectives, Development and Status (2016)")],
        "dataNotes": ["PSI record dates (2001–2008) appear to be copied from another record and do not match the Cygnus flight; years left null."],
    },
    {
        "id": "Saffire-II", "name": "Spacecraft Fire Experiment – II", "psi": "PSI-99", "doi": "10.60555/2chp-m469",
        "family": "Saffire-Cygnus", "hardware": "Saffire flow duct in the Cygnus pressurized cargo module",
        "platform": "Cygnus", "fuelPhase": "solid", "direction": ["prevention"], "safetyConsequence": 3,
        "objective": "Measure low-g flammability of several spacecraft materials at realistic scale and compare with NASA's 1-g material flammability screening test.",
        "fuel": {"types": ["SIBAL (cotton-fiberglass)", "silicone", "PMMA (flat and structured)", "PMMA with Nomex"],
                 "geometry": "9 strips on one sample card", "size": "5 cm x 29 cm each, 0.27–10 mm thick"},
        "varied": ["material", "thickness", "flow direction (concurrent / opposed)"],
        "constant": ["air flow 20 cm/s", "Cygnus cabin atmosphere (~22 % O2, ~100 kPa)"],
        "diagnostics": ["2 cameras", "thermocouples", "2 radiometers", "pressure, O2 and CO2 sensors", "2 anemometers"],
        "resultSummary": "Nine material samples were burned one after another in a Cygnus vehicle. Thin silicone did not sustain a flame in microgravity, "
                         "while cotton-fiberglass fabric burned its full 29 cm length at 2.1–2.6 mm/s. Thick PMMA flames stayed anchored near the base, "
                         "spreading far more slowly than the 1-g comparison.",
        "keyFindings": [
            {"text": "Microgravity flame spread over SIBAL fabric in 20 cm/s concurrent flow was 2.1–2.6 mm/s, burning the full 29 cm sample (PSI test table).", "sourceId": "psi-99"},
            {"text": "Silicone samples ignited (80 W, 9.2 s) but had insignificant burn time in microgravity, while in the 1-g comparison the thinnest (0.27 mm) silicone sample burned completely.", "sourceId": "psi-99"},
            {"text": "Reducing pressure slows concurrent flame spread over thick PMMA toward the microgravity value; a mixed-convection correlation extrapolated to low pressure predicts the Saffire II spread rate.", "sourceId": "ntrs-20200000557"},
        ],
        "flight": True, "years": "2016–2017 (PSI record)",
        "earthRelevance": "Low-pressure ground tests may approximate untested gravity levels for thick and thin solids (NTRS 20200000557).",
        "sources": [psi(99),
                    ntrs("20200000557", "Buoyancy Effects on Concurrent Flame Spread Over Thick PMMA (2018)"),
                    ntrs("20170000230", "Operation and Development Status of the Spacecraft Fire Experiments (Saffire) (2016)")],
    },
    {
        "id": "Saffire-III", "name": "Spacecraft Fire Experiment – III", "psi": "PSI-100", "doi": "10.60555/040q-4h36",
        "family": "Saffire-Cygnus", "hardware": "Saffire-III flow duct in the Cygnus cargo vehicle",
        "platform": "Cygnus", "fuelPhase": "solid", "direction": ["prevention"], "safetyConsequence": 3,
        "objective": "Repeat the Saffire-I large-scale fabric burn at a higher flow (30 cm/s) to see how rapidly a large fire grows in low gravity and whether it reaches a steady spread rate.",
        "fuel": {"types": ["SIBAL (75/25 cotton/fiberglass fabric)"], "geometry": "large fabric sheet", "size": "94 cm x 40.6 cm"},
        "varied": ["flow direction (concurrent vs opposed)"],
        "constant": ["air flow 30 cm/s", "material (SIBAL)"],
        "diagnostics": ["2 cameras", "thermocouples", "2 radiometers", "pressure, O2 and CO2 sensors", "2 anemometers"],
        "resultSummary": "Two large SIBAL sheets were burned in a Cygnus vehicle at 30 cm/s air flow (one concurrent, one opposed), extending Saffire-I's 20 cm/s case. "
                         "The PSI table lists conditions only; no burn results are tabulated.",
        "keyFindings": [
            {"text": "Saffire-III used the same SIBAL material as Saffire-I but a higher flow velocity of 30 cm/s (vs 20 cm/s), with concurrent and opposed flow.", "sourceId": "psi-100"},
            {"text": "The Saffire series is designed to reduce uncertainty in spacecraft fire-safety design by testing at realistic length scales in an uncrewed vehicle.", "sourceId": "ntrs-20170001636"},
        ],
        "flight": True, "years": "2017 (PSI record start date)",
        "earthRelevance": "Fire behaviour in sealed vehicles informs fire safety in mines, aircraft and submarines (PSI research impacts).",
        "sources": [psi(100), ntrs("20170001636", "The Spacecraft Fire Experiment (Saffire) – Objectives, Development and Status (2016)")],
    },
    # ------------------------------------------------------------------ MDCA droplets
    {
        "id": "FLEX", "name": "Flame Extinguishment Experiment", "psi": "PSI-69", "doi": "10.60555/mbq8-0451",
        "family": "MDCA-CIR", "hardware": "Combustion Integrated Rack (CIR), Multi-user Droplet Combustion Apparatus (MDCA)",
        "platform": "ISS", "fuelPhase": "liquid", "direction": ["suppression"], "safetyConsequence": 3,
        "objective": "Map flammability limits of liquid fuels in microgravity, measure the effectiveness of gaseous suppressants (CO2, He) and determine the "
                     "limiting oxygen index (LOI) as a function of pressure and suppressant concentration.",
        "fuel": {"types": ["methanol", "n-heptane"], "geometry": "free-floated or fiber-tethered droplets",
                 "size": "initial diameter 1.1–4.7 mm (PSI table)"},
        "varied": ["ambient O2 mole fraction", "ambient pressure", "suppressant type and fraction (CO2, He)", "initial droplet diameter", "fuel"],
        "constant": ["quiescent ambient (most tests)", "microgravity"],
        "diagnostics": ["droplet and flame imaging (droplet diameter history, burning rate, extinction diameter)", "flame radiation", "chamber pressure and composition"],
        "resultSummary": "274 droplet tests burned methanol and heptane in mixtures of O2, N2, CO2 and He at 0.7–3 atm. Each test ended in flame extinction, "
                         "droplet disruption or burning to completion. The data give the oxygen level below which these fuels stop burning and how much CO2 or helium is needed.",
        "keyFindings": [
            {"text": "The limiting oxygen index for methanol droplets in O2–N2–CO2 and O2–N2–He mixtures is around 12–13 % O2 by volume.", "sourceId": "ntrs-20130014061"},
            {"text": "Droplets of ~1.5–4 mm captured both diffusive extinction (too little residence time) and radiative extinction (too much heat loss).", "sourceId": "ntrs-20130014061"},
            {"text": "FLEX was designed to assess fire suppressants in microgravity and the effect of candidate crew exploration atmospheres on fire suppression.", "sourceId": "ntrs-20090014812"},
        ],
        "flight": True, "years": "2009–2011 (test dates in PSI table)",
        "earthRelevance": "Suppressant effectiveness results can inform less harmful fire-suppression systems; relevant to submarines and high-altitude aircraft (PSI research impacts).",
        "sources": [psi(69),
                    ntrs("20150023456", "NASA/TP: Detailed Results from the Flame Extinguishment Experiment (FLEX) March 2009 to December 2011 (2015)"),
                    ntrs("20130014061", "Methanol Droplet Combustion in Oxygen-Inert Environments in Microgravity (2013)"),
                    ntrs("20090014812", "Multi-User Droplet Combustion Apparatus – Flame Extinguishment Experiment (2009)")],
    },
    {
        "id": "FLEX-2", "name": "Flame Extinguishment Experiment – 2", "psi": "PSI-68", "doi": "10.60555/byp8-h018",
        "family": "MDCA-CIR", "hardware": "Combustion Integrated Rack (CIR), Multi-user Droplet Combustion Apparatus (MDCA)",
        "platform": "ISS", "fuelPhase": "liquid", "direction": ["suppression", "fundamental"], "safetyConsequence": 3,
        "objective": "Extend FLEX to fuels and conditions closer to real combustors: bi-component droplets, soot formation, extinction boundaries, "
                     "droplet arrays and slow convective flow, to provide benchmark data for numerical models.",
        "fuel": {"types": ["iso-octane", "n-octane", "n-heptane", "n-decane", "ethanol", "propanol/glycerol mixtures", "heptane/iso-octane 50/50"],
                 "geometry": "single droplets and binary droplet arrays, free or fiber-supported", "size": "initial diameter 1.5–5 mm (planned)"},
        "conditions": {"o2Pct": [17.0, 30.0], "pressureKpa": [50.7, 304.0], "flowCmS": [0.1, 5.0], "gravityG": [0.0, 0.0], "diluents": ["N2", "He"]},
        "varied": ["fuel type / mixture", "ambient gas composition (O2/N2 or O2/He)", "ambient pressure", "initial droplet diameter",
                   "droplet translation velocity", "droplet spacing in arrays"],
        "constant": ["ambient temperature 25 °C (planned matrix)"],
        "diagnostics": ["color video (near-real-time downlink)", "high-speed droplet/flame imaging", "chamber pressure and temperature"],
        "resultSummary": "FLEX-2 burned single and paired droplets of pure fuels and mixtures in O2/N2 and O2/He atmospheres at 0.5–3 atm to provide benchmark data "
                         "for droplet combustion models. PSI publishes only the planned test matrix, not per-test results.",
        "keyFindings": [
            {"text": "Independently varied parameters were fuel type, ambient gas composition, pressure, initial droplet diameter, droplet translation velocity, and droplet spacing in a binary array.", "sourceId": "psi-68"},
            {"text": "ISS droplet experiments with large bi-component (n-decane/hexanol) droplets at elevated pressure showed a very weak visible hot flame while the burning rate stayed relatively high, suggesting coexisting cool and hot flames.", "sourceId": "ntrs-20170000666"},
        ],
        "flight": True, "years": "2016–2019 (PSI record)", "nTests": 0,
        "earthRelevance": "Benchmark droplet data support surrogate fuels and cleaner, more efficient combustor and jet-engine design (PSI research impacts).",
        "sources": [psi(68),
                    ntrs("20170000666", "A Burke-Schumann Analysis of Dual-Flame Structure Supported by a Burning Droplet (2016)"),
                    paper("10.1007/s12217-014-9372-2", "Dietrich et al., Droplet Combustion Experiments Aboard the International Space Station, Microgravity Sci. Technol. 2014")],
    },
    {
        "id": "CFI", "name": "Cool Flames Investigation", "psi": "PSI-39", "doi": "10.60555/m6pj-a914",
        "family": "MDCA-CIR", "hardware": "Combustion Integrated Rack (CIR), Multi-User Droplet Combustion Apparatus (MDCA)",
        "platform": "ISS", "fuelPhase": "liquid", "direction": ["fundamental"], "safetyConsequence": 1,
        "objective": "Study low-temperature 'cool flame' droplet combustion of n-dodecane and n-dodecane/iso-dodecane mixtures at 0.5–5 atm, including helium dilution, "
                     "and relate droplet size, pressure and extinction.",
        "fuel": {"types": ["n-dodecane", "n-dodecane/iso-dodecane 75/25 and 60/40"], "geometry": "free or fiber-tethered droplets",
                 "size": "initial diameter 3.8–6.4 mm (CFI DataSummary)"},
        "varied": ["pressure", "O2 mole fraction", "helium dilution", "fuel mixture", "droplet size", "fiber support"],
        "constant": ["quiescent ambient", "microgravity"],
        "diagnostics": ["black-and-white droplet camera", "UV camera (OH* chemiluminescence)", "narrow- and wide-band radiometers", "high-resolution cameras"],
        "resultSummary": "79 unique droplet tests explored how dodecane droplets keep burning after the visible hot flame goes out, sustained by an invisible low-temperature "
                         "'cool flame'. Hot- and cool-flame burning rates and extinction diameters are tabulated for most tests.",
        "keyFindings": [
            {"text": "Cool-flame-supported quasi-steady droplet burning was first observed on the ISS; these flames are not visible to the naked eye.", "sourceId": "ntrs-20205008449"},
            {"text": "Helium dilution drastically increases the cool-flame extinction diameter compared with N2, CO2 or Xe, while Xe gives longer burning and smaller extinction diameter.", "sourceId": "ntrs-20205008449"},
        ],
        "flight": True, "years": "2017 (test dates in PSI table)",
        "earthRelevance": "Cool-flame chemistry matters for ignition of practical fuels and for HCCI / diesel engine design (PSI research impacts).",
        "sources": [psi(39),
                    ntrs("20205008449", "Effects of Ambient Inert Gas Properties on Cool-Flame Combustion of Normal-Alkane Droplets in Microgravity (2020)"),
                    paper("10.1007/s12217-024-10115-x", "Dietrich et al., Low Temperature n-Dodecane Droplet Combustion Experiments Aboard the ISS, 2024")],
    },
    # ------------------------------------------------------------------ SAME (MSG)
    {
        "id": "SAME", "name": "Smoke and Aerosol Measurement Experiment", "psi": "PSI-102", "doi": "10.60555/gd4k-8h62",
        "family": "SAME-MSG", "hardware": "Microgravity Science Glovebox (MSG), Comparative Soot Diagnostic hardware with aging chamber",
        "platform": "ISS", "fuelPhase": "solid", "direction": ["detection"], "safetyConsequence": 3,
        "objective": "Measure the size of smoke particles produced by overheated spacecraft materials in microgravity and relate them to smoke generation and transport, "
                     "to evaluate and design spacecraft smoke detectors.",
        "fuel": {"types": ["Teflon", "Kapton", "silicone rubber", "cotton lampwick", "dibutyl phthalate (DBP)"],
                 "geometry": "heated samples in a smoke-generation tube", "size": None},
        "varied": ["material", "air flow past sample (2–8 cm/s in the flown tests)", "sample heating (Rt/R0)", "smoke aging time (~10 s to ~33 min)"],
        "constant": ["heating below ignition (smoke, not flame)"],
        "diagnostics": ["thermophoretic samplers / TEM grids", "two commercial smoke detectors", "DustTrak aerosol monitor and ionization detector (Commercial Diagnostic Enclosure)", "P-Trak particle counter", "video", "sample mass loss"],
        "resultSummary": "Spacecraft materials were overheated on the ISS to produce smoke, which was aged and measured by detectors and particle samplers. "
                         "The hypothesis was that low-gravity smoke particles grow larger than on Earth, which could change how smoke detectors respond.",
        "keyFindings": [
            {"text": "Hypothesis: without buoyant flow, smoke particles grow larger in microgravity (longer residence time near the source), which may stop some detectors from alarming.", "sourceId": "psi-102"},
            {"text": "All current spacecraft smoke detectors were designed from normal-gravity data; earlier shuttle experiments saw larger particles in low gravity in some cases.", "sourceId": "ntrs-20070031686"},
            {"text": "After SAME, the TEM grids returned to the ground were contaminated with foreign particles and unusable, which motivated the SAME-R reflight.", "sourceId": "psi-101"},
        ],
        "flight": True, "years": "2007 (ISS Expedition 15)",
        "earthRelevance": "Better smoke detectors for extreme environments such as submarines and underwater laboratories (PSI research impacts).",
        "sources": [psi(102), psi(101),
                    ntrs("20070031686", "Particle and Smoke Detection on ISS for Next Generation Smoke Detectors (2007)"),
                    ntrs("20130000422", "Particle Morphology and Size Results from the Smoke Aerosol Measurement Experiment-2 (2012)")],
        "dataNotes": ["Flight year: NTRS 20130000422 says the original SAME flew during ISS Expedition 15; PSI record dates (2001–2008) are the project period."],
    },
    {
        "id": "SAME-R", "name": "Smoke Aerosol Measurement Experiment – Reflight", "psi": "PSI-101", "doi": "10.60555/2np7-jv14",
        "family": "SAME-MSG", "hardware": "Microgravity Science Glovebox (MSG), SAME hardware with M-pass instrument",
        "platform": "ISS", "fuelPhase": "solid", "direction": ["detection"], "safetyConsequence": 3,
        "objective": "Repeat SAME with new materials (Pyrell foam), wider conditions (higher heating, no-flow heating) and better diagnostics to quantify smoke particle "
                     "size distributions in low gravity.",
        "fuel": {"types": ["Kapton", "silicone", "cotton lampwick", "Teflon", "Pyrell foam"], "geometry": "heated samples", "size": None},
        "varied": ["material", "sample heating (Rt/R0)", "inlet air velocity (0–8.1 cm/s)", "smoke aging time"],
        "constant": ["heating below ignition"],
        "diagnostics": ["TEM grids (thermal precipitator)", "prototype two-moment smoke detector", "M-pass", "DustTrak", "ionization detector", "P-Trak"],
        "resultSummary": "SAME-R completed 66 test points on the ISS in July–September 2010 with five spacecraft materials. Most average smoke particle sizes were "
                         "200–400 nm, with some quiescent (no-flow) cases producing substantially larger particles.",
        "keyFindings": [
            {"text": "The majority of average smoke particle sizes were in the 200–400 nm range, with quiescent cases producing some substantially larger particles.", "sourceId": "ntrs-20130000422"},
            {"text": "Smoke was aged for 11 to 1800 s to simulate transport time from source to detector; flow past the sample ranged from quiescent to 8 cm/s.", "sourceId": "ntrs-20130000422"},
            {"text": "SAME-R flight tests ran from July 16 to September 9, 2010, completing 66 test points.", "sourceId": "psi-101"},
        ],
        "flight": True, "years": "2010",
        "earthRelevance": "Detector designs from SAME data apply to submarines and underwater laboratories (PSI research impacts).",
        "sources": [psi(101),
                    ntrs("20130000422", "Particle Morphology and Size Results from the Smoke Aerosol Measurement Experiment-2 (2012)"),
                    ntrs("20150010172", "Particle Morphology Results from the Smoke Aerosol Measurement Experiment-Reflight (2012)")],
    },
    # ------------------------------------------------------------------ ACME (CIR)
    {
        "id": "ACME-BRE", "name": "ACME – Burning Rate Emulator", "psi": "PSI-20", "doi": "10.60555/vb93-3y72",
        "family": "ACME-CIR", "hardware": "Combustion Integrated Rack (CIR), ACME modular hardware, porous flat burner with heat-flux gauge",
        "platform": "ISS", "fuelPhase": "gas", "direction": ["prevention"], "safetyConsequence": 2,
        "objective": "Use a gas burner that emulates condensed (solid/liquid) fuels to find the conditions for steady burning in a quiescent microgravity ambient, "
                     "including candidate spacecraft atmospheres (21 % O2 at 14.7 psia, 26.5 % at 10.2 psia, 34 % at 8.2 psia).",
        "fuel": {"types": ["ethylene (C2H4)", "ethylene 50 % in N2", "methane (CH4)"], "geometry": "flat porous circular burner", "size": "25 and 50 mm diameter"},
        "varied": ["ambient O2 (21–40 %)", "pressure", "fuel and dilution", "burner size", "fuel flow rate"],
        "constant": ["quiescent ambient (no forced flow)", "microgravity"],
        "diagnostics": ["heat-flux gauge and burner surface temperature", "flame imaging (ACME cameras)"],
        "resultSummary": "A gas-fed burner emulating solids like PMMA and nylon burned in still air on the ISS. In elevated-oxygen atmospheres being considered for "
                         "future spacecraft the flames kept burning without any air flow, whereas at 21 % O2 they self-extinguished in a short time.",
        "keyFindings": [
            {"text": "Quasi-steady burning of emulated condensed materials (e.g. PMMA, nylon) was observed in microgravity without air flow — even though stopping ventilation is a standard step in fighting spacecraft fires.", "sourceId": "psi-20"},
            {"text": "Sustained burning without air flow was seen in elevated-O2 atmospheres considered for future spacecraft, whereas flames at 21 % O2 self-extinguished quickly.", "sourceId": "psi-20"},
            {"text": "Results suggest NASA may want to increase use of its cone-calorimeter Test 2, which can measure the material properties that govern these microgravity flames.", "sourceId": "psi-20"},
        ],
        "flight": True, "years": "2019–2021 (test dates in PSI table)",
        "earthRelevance": "Links microgravity flammability to cone-calorimeter (NASA-STD-6001 Test 2) material properties (PSI research impacts).",
        "sources": [psi(20),
                    ntrs("20170009141", "Emulation of Condensed Fuel Flames Using a Burning Rate Emulator (BRE) in Microgravity (2017)"),
                    ntrs("20220015583", "ACME: Advanced Combustion via Microgravity Experiments (poster, 2022)"),
                    paper("10.1016/j.combustflame.2021.01.035", "Dehghani et al., Burning in microgravity: Experimental results and analysis, Combust. Flame 2021")],
    },
    {
        "id": "ACME-CFI-G", "name": "ACME – Cool Flames Investigation with Gases", "psi": "PSI-159", "doi": "10.60555/cyt1-kh64",
        "family": "ACME-CIR", "hardware": "Combustion Integrated Rack (CIR), ACME modular hardware, spherical porous burner",
        "platform": "ISS", "fuelPhase": "gas", "direction": ["fundamental"], "safetyConsequence": 2,
        "objective": "Determine the conditions for steady cool diffusion flames of gaseous fuels on spherical porous burners, for normal and inverse flames over "
                     "a broad range of stoichiometric mixture fraction, adiabatic flame temperature and flow rate.",
        "fuel": {"types": ["ethane", "propane", "n-butane", "diluted ethane/propane/butane (30–50 %)"],
                 "geometry": "spherical porous burner (normal: fuel out; inverse: oxidizer out)", "size": None},
        "varied": ["fuel and fuel dilution", "ambient O2 (normal flames ~18–40 %)", "oxidizer-stream O2 (inverse flames 12–85 %)", "pressure (~0.5–3.3 bar)", "fuel / oxidizer flow rate"],
        "constant": ["quiescent chamber", "microgravity"],
        "diagnostics": ["cameras", "radiometers", "photomultiplier tubes", "thermocouples (burner temperature)"],
        "resultSummary": "Spherical gas flames on the ISS were used to look for cool flames and to map when flames ignite, self-extinguish or burn until the fuel is cut. "
                         "Inverse flames reached the highest oxygen levels flown in these data (oxidizer stream up to 85 % O2), but they are gas flames, not burning materials.",
        "keyFindings": [
            {"text": "Hypotheses include demonstrating, for the first time, steady cool diffusion flames on spherical porous burners, inverse cool diffusion flames, and cool flames over a wide range of Zst, Tad and pressure.", "sourceId": "psi-159"},
            {"text": "ACME's six investigations of gaseous non-premixed flames ran on the ISS from Nov 2017 to Feb 2022; three of them used porous spherical burners giving a nominally one-dimensional flame.", "sourceId": "ntrs-20220015583"},
        ],
        "flight": True, "years": "2021 (YYDDD test codes in PSI table)",
        "earthRelevance": "Cool-flame kinetics could enable ultra-lean, higher-efficiency engines (PSI research impacts).",
        "sources": [psi(159),
                    ntrs("20220015583", "ACME: Advanced Combustion via Microgravity Experiments (poster, 2022)"),
                    ntrs("20210021781", "Recent Research on Flames of Gaseous Fuel Aboard the International Space Station (2021)")],
    },
    {
        "id": "ACME-E-FIELD", "name": "ACME – Electric-Field Effects on Laminar Diffusion Flames", "psi": "PSI-22", "doi": "10.60555/se5a-8c73",
        "family": "ACME-CIR", "hardware": "Combustion Integrated Rack (CIR), ACME coflow and gas-jet burners with high-voltage mesh electrode (up to 10 kV)",
        "platform": "ISS", "fuelPhase": "gas", "direction": ["fundamental"], "safetyConsequence": 1,
        "objective": "Understand how electric fields act on laminar diffusion flames in microgravity: voltage vs chemi-ion current, dynamic flame response, soot formation "
                     "and stabilized near-limit lifted flames.",
        "fuel": {"types": ["methane", "ethylene", "N2-diluted methane / ethylene"], "geometry": "coflow burner and gas-jet burner", "size": None},
        "varied": ["fuel and N2 dilution", "electrode polarity", "field strength (voltage)", "fuel flow rate", "coflow velocity"],
        "constant": ["microgravity"],
        "diagnostics": ["voltage–current (ion current) measurement", "high-resolution cameras", "filtered spectral imaging (chemiluminescence, soot volume fraction)", "thermopile radiometers"],
        "resultSummary": "Methane and ethylene flames on the ISS were exposed to electric fields of either polarity to study ion-driven flows, soot and flame stability "
                         "without buoyancy. It is a fundamental combustion study, not a fire-safety test.",
        "keyFindings": [
            {"text": "Microgravity isolates electric-field (ion-driven convection) effects from buoyancy; voltage–current curves reveal ion-driven convection effects.", "sourceId": "psi-22"},
            {"text": "Electric-field control of flames may reduce pollutant and soot emissions in terrestrial combustion; the work is not aimed at a space application.", "sourceId": "psi-22"},
        ],
        "flight": True, "years": "2018 (test dates in PSI table)",
        "earthRelevance": "Electric-field flame control may lower soot and pollutant emissions and improve combustion efficiency (PSI research impacts).",
        "sources": [psi(22),
                    paper("10.1016/j.combustflame.2022.112443", "Chien et al., Electric-field effects on methane coflow flames aboard the ISS: ACME E-FIELD flames, Combust. Flame 2022"),
                    ntrs("20220015583", "ACME: Advanced Combustion via Microgravity Experiments (poster, 2022)")],
        "dataNotes": ["Partial gravity: the concept treats E-FIELD as an electric-field analogue of buoyancy; PSI text only states that microgravity isolates field effects from buoyancy."],
    },
    # ------------------------------------------------------------------ MSG gas jets
    {
        "id": "SPICE", "name": "Smoke Point In Co-flow Experiment", "psi": "PSI-107", "doi": "10.60555/9kbh-e962",
        "family": "MSG-SPICE", "hardware": "Microgravity Science Glovebox (MSG), SPICE flow duct with nozzles",
        "platform": "ISS", "fuelPhase": "gas", "direction": ["fundamental", "prevention"], "safetyConsequence": 2,
        "objective": "Find the laminar smoke point (onset of soot emission) of non-buoyant gas-jet flames in co-flowing air and how burner diameter, co-flow velocity and fuel affect it.",
        "fuel": {"types": ["methane", "ethylene", "propane", "propylene", "propylene/nitrogen mixtures"], "geometry": "round jet nozzles in co-flowing air",
                 "size": "nozzle diameters 0.41, 0.76 and 1.6 mm"},
        "varied": ["fuel", "nozzle diameter", "fuel flow rate", "co-flow air velocity (~5–65 cm/s)"],
        "constant": ["cabin air co-flow (nominal 21 % O2, 101 kPa per SPICE Final Report)", "microgravity"],
        "diagnostics": ["still and video cameras (flame length, smoke point)", "radiative heat loss", "co-flow velocity"],
        "resultSummary": "526 small gas-jet flames were studied in the glovebox to find when they begin to emit soot. Soot governs flame heat emission, so the data help "
                         "predict fire spread and support material flammability criteria.",
        "keyFindings": [
            {"text": "Soot dominates heat emitted from flames in both normal gravity and microgravity fires; controlling it matters for preventing fire spread.", "sourceId": "ntrs-20090014827"},
            {"text": "In total 526 flames were studied, with co-flow velocities from 5.4 to 65 cm/s and three burner diameters.", "sourceId": "psi-107"},
        ],
        "flight": True, "years": None,
        "earthRelevance": "Better soot control for jet engines and power-generation boilers (NTRS 20090014827).",
        "sources": [psi(107), ntrs("20090014827", "Smoke Point in Co-flow Experiment (2009)")],
        "dataNotes": ["The PSI table gives GMT day-of-year only, without the year; years left null."],
    },
    {
        "id": "SLICE", "name": "Structure and Liftoff In Combustion Experiment", "psi": "PSI-106", "doi": "10.60555/pm12-rg61",
        "family": "MSG-SPICE", "hardware": "Microgravity Science Glovebox (MSG), SPICE/SLICE fan-driven flow duct with exchangeable burner tubes",
        "platform": "ISS", "fuelPhase": "gas", "direction": ["fundamental"], "safetyConsequence": 2,
        "objective": "Understand the structure and stability (lift-off, blow-out) of laminar co-flow diffusion flames in microgravity, including fuel dilution effects on soot.",
        "fuel": {"types": ["methane (100, 70, 40 % in N2)", "ethylene (100, 20 % in N2)", "ethane", "propane"], "geometry": "co-flow jet burner", "size": None},
        "varied": ["fuel and N2 dilution", "burner diameter", "fuel and co-flow velocity"],
        "constant": ["air co-flow", "microgravity"],
        "diagnostics": ["high-resolution color still camera with sensor overlay", "flow-rate and temperature sensors", "soot temperature / volume fraction from flame emission"],
        "resultSummary": "On 12 test days in 2012, methane, ethylene and other gas flames were photographed in co-flowing air to study lift-off, blow-out and soot. "
                         "Microgravity flames were longer and sootier than their 1-g counterparts.",
        "keyFindings": [
            {"text": "Microgravity sooting CH4 flames had lower soot temperatures and higher soot volume fractions than normal-gravity flames, with soot shifting from the centerline to the wings.", "sourceId": "ntrs-20140017780"},
            {"text": "Non-buoyant luminous flame lengths are proportional to fuel mass flow rate and noticeably longer than 1-g flames; buoyancy narrows the flame by radially inward convection.", "sourceId": "ntrs-20150002322"},
        ],
        "flight": True, "years": "2012 (test dates in PSI table)",
        "earthRelevance": "Improved soot and flame-stability models for cleaner engines and industrial burners (PSI research impacts).",
        "sources": [psi(106),
                    ntrs("20140017780", "An Experimental and Computational Study on Soot Formation in a Coflow Jet Flame Under Microgravity and Normal Gravity (2014)"),
                    ntrs("20150002322", "A Computational and Experimental Study of Coflow Laminar Methane/Air Diffusion Flames (2014)")],
    },
]
