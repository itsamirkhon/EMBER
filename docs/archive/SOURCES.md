# EMBER content sources

All sources used by the content layer (`missions.json`, `claims.json`, `extraction_eval.json`, `earth.json`, `history.json`).
Owner: content pipeline (`pipeline/content/`). URL check on 2026-11-14: all PSI, nasa.gov, spinoff.nasa.gov and nssdc.gsfc.nasa.gov URLs returned HTTP 200. The NTRS web front end (`ntrs.nasa.gov/citations/<id>`) returned 200 earlier in the day but 503/504/timeouts during the final check (its home page timed out too). Every NTRS id was confirmed to exist through the NTRS API (`/api/citations/<id>` returned the record cached in `pipeline/content/cache/ntrs-<id>.json`). Re-check those links when NTRS is back.

## How the text was obtained

- **PSI investigation records**: the PSI site is an Angular app; its record JSON is served by `https://psi.nasa.gov/geode-py/ws/repo/investigations/PSI-NN` (fields `objective`, `approach`, `researchImpacts`, `hypothesis`). Cited by the human-facing page `https://psi.nasa.gov/physci/repo/data/investigations/PSI-NN`.
- **NTRS**: `https://ntrs.nasa.gov/api/citations/<id>` (title + abstract). Cited as `https://ntrs.nasa.gov/citations/<id>`.
- Raw responses are cached in `pipeline/content/cache/` (`psi-PSI-NN.json`, `ntrs-<id>.json`); the normalized texts that all quotes are checked against are in `pipeline/content/cache/sources.json`.
- Reproduce: `python3 pipeline/content/extract_claims.py` (fills the cache; runs Claude extraction only if `ANTHROPIC_API_KEY` is set), `python3 pipeline/content/extract_claims.py --offline --verify` (quote check), `python3 pipeline/content/build_claims.py`, `python3 pipeline/content/build_eval.py`.

## Claim sources (cached, quote-verified)

| sourceId | Investigations | Claims | Source |
|---|---|---|---|
| `ntrs-19990053973` | context | 0 | [NTRS 19990053973: Flow Effects on the Flammability Diagrams of Solid Fuels: Microgravity Influence on Ignition Delay](https://ntrs.nasa.gov/citations/19990053973) |
| `ntrs-20040053578` | SAME | 3 | [NTRS 20040053578: "Smoke": Characterization Of Smoke Particulate For Spacecraft Fire Detection](https://ntrs.nasa.gov/citations/20040053578) |
| `ntrs-20050199446` | context | 0 | [NTRS 20050199446: TIGER Burned Brightly in JAMIC](https://ntrs.nasa.gov/citations/20050199446) |
| `ntrs-20050217475` | context | 1 | [NTRS 20050217475: New Species of Fire Discovered: Fingering Flamelets Form a Dynamic Population](https://ntrs.nasa.gov/citations/20050217475) |
| `ntrs-20070031686` | SAME | 3 | [NTRS 20070031686: Particle and Smoke Detection on ISS for Next Generation Smoke Detectors](https://ntrs.nasa.gov/citations/20070031686) |
| `ntrs-20080034883` | context | 2 | [NTRS 20080034883: Microgravity Flame Spread in Exploration Atmospheres: Pressure, Oxygen, and Velocity Effects on Opposed and Concurrent Flame Spread](https://ntrs.nasa.gov/citations/20080034883) |
| `ntrs-20090012334` | context | 2 | [NTRS 20090012334: Pressure Effects on the Self-Extinguishment Limits of Aerospace Materials](https://ntrs.nasa.gov/citations/20090012334) |
| `ntrs-20090014812` | FLEX | 2 | [NTRS 20090014812: Multi-User Droplet Combustion Apparatus - Flame Extinguishment Experiment](https://ntrs.nasa.gov/citations/20090014812) |
| `ntrs-20090014827` | SPICE | 2 | [NTRS 20090014827: Smoke Point in Co-flow Experiment](https://ntrs.nasa.gov/citations/20090014827) |
| `ntrs-20130000422` | SAME-R | 5 | [NTRS 20130000422: Particle Morphology and Size Results from the Smoke Aerosol Measurement Experiment-2](https://ntrs.nasa.gov/citations/20130000422) |
| `ntrs-20130000677` | Saffire-I | 1 | [NTRS 20130000677: Large Scale Experiments on Spacecraft Fire Safety](https://ntrs.nasa.gov/citations/20130000677) |
| `ntrs-20130014061` | FLEX | 4 | [NTRS 20130014061: Methanol Droplet Combustion in Oxygen-Inert Environments in Microgravity](https://ntrs.nasa.gov/citations/20130014061) |
| `ntrs-20140006750` | FLEX | 2 | [NTRS 20140006750: Cool-flame Extinction During N-Alkane Droplet Combustion in Microgravity](https://ntrs.nasa.gov/citations/20140006750) |
| `ntrs-20140011099` | BASS | 6 | [NTRS 20140011099: Thickness and Fuel Preheating Effects on Material Flammability in Microgravity from the BASS Experiment](https://ntrs.nasa.gov/citations/20140011099) |
| `ntrs-20140017780` | SPICE | 2 | [NTRS 20140017780: An Experimental and Computational Study on Soot Formation in a Coflow Jet Flame Under Microgravity and Normal Gravity](https://ntrs.nasa.gov/citations/20140017780) |
| `ntrs-20150000894` | Saffire-I | 4 | [NTRS 20150000894: Large-Scale Spacecraft Fire Safety Tests](https://ntrs.nasa.gov/citations/20150000894) |
| `ntrs-20150008961` | BASS | 3 | [NTRS 20150008961: Microgravity Flammability of PMMA Rods in Concurrent Flow](https://ntrs.nasa.gov/citations/20150008961) |
| `ntrs-20150008962` | BASS, BASS-II | 2 | [NTRS 20150008962: Concurrent Flame Growth, Spread and Extinction over Composite Fabric Samples in Low Speed Purely Forced Flow in Microgravity](https://ntrs.nasa.gov/citations/20150008962) |
| `ntrs-20150010172` | SAME-R | 0 | [NTRS 20150010172: Particle Morphology Results from the Smoke Aerosol Measurement Experiment-Reflight](https://ntrs.nasa.gov/citations/20150010172) |
| `ntrs-20150011070` | SLICE | 0 | [NTRS 20150011070: A Numerical and Experimental Study of Coflow Laminar Diffusion Flames: Effects of Gravity and Inlet Velocity](https://ntrs.nasa.gov/citations/20150011070) |
| `ntrs-20150018397` | FLEX | 2 | [NTRS 20150018397: Combustion Characteristics in a Non-Premixed Cool-Flame Regime of n-Heptane in Microgravity](https://ntrs.nasa.gov/citations/20150018397) |
| `ntrs-20150019858` | BASS-II | 0 | [NTRS 20150019858: Results from On-Board CSA-CP and CDM Sensor Readings During the Burning and Suppression of Solids II (BASS-II) Experiment in the Microgravity Science Glovebox (MSG)](https://ntrs.nasa.gov/citations/20150019858) |
| `ntrs-20150021491` | context | 0 | [NTRS 20150021491: Evidence Report: Risk of Hypobaric Hypoxia from the Exploration Atmosphere](https://ntrs.nasa.gov/citations/20150021491) |
| `ntrs-20150022421` | Saffire-II | 4 | [NTRS 20150022421: Buoyant Effects on the Flammability of Silicone Samples Planned for the Spacecraft Fire Experiment (Saffire)](https://ntrs.nasa.gov/citations/20150022421) |
| `ntrs-20150023456` | FLEX | 1 | [NTRS 20150023456: Detailed Results from the Flame Extinguishment Experiment (FLEX) March 2009 to December 2011](https://ntrs.nasa.gov/citations/20150023456) |
| `ntrs-20160000344` | FLEX | 1 | [NTRS 20160000344: Aspects of Cool-Flame Supported Droplet Combustion in Microgravity](https://ntrs.nasa.gov/citations/20160000344) |
| `ntrs-20160000593` | BASS-II | 3 | [NTRS 20160000593: Combustion of Solids in Microgravity: Results from the BASS-II Experiment](https://ntrs.nasa.gov/citations/20160000593) |
| `ntrs-20160010073` | ACME-BRE | 1 | [NTRS 20160010073: A Burning Rate Emulator (BRE) for Study in Microgravity](https://ntrs.nasa.gov/citations/20160010073) |
| `ntrs-20160012298` | SLICE | 1 | [NTRS 20160012298: Quantitative Measurements of CH* Concentration in Normal Gravity and Microgravity Coflow Laminar Diffusion Flames](https://ntrs.nasa.gov/citations/20160012298) |
| `ntrs-20160012691` | BASS-II | 3 | [NTRS 20160012691: Correlation of Normal Gravity Mixed Convection Blowoff Limits with Microgravity Forced Flow Blowoff Limits](https://ntrs.nasa.gov/citations/20160012691) |
| `ntrs-20170000230` | Saffire-I | 1 | [NTRS 20170000230: Operation and Development Status of the Spacecraft Fire Experiments (Saffire)](https://ntrs.nasa.gov/citations/20170000230) |
| `ntrs-20170000666` | FLEX-2 | 1 | [NTRS 20170000666: A Burke-Schumann Analysis of Dual-Flame Structure Supported by a Burning Droplet](https://ntrs.nasa.gov/citations/20170000666) |
| `ntrs-20170001636` | Saffire-I | 1 | [NTRS 20170001636: The Spacecraft Fire Experiment (Saffire) - Objectives, Development and Status](https://ntrs.nasa.gov/citations/20170001636) |
| `ntrs-20170006615` | BASS-II | 0 | [NTRS 20170006615: Mixed Convection Blowoff Limits as a Function of Oxygen Concentration and Upward Forced Stretch Rate for Burning Pmma Rods of Various Sizes](https://ntrs.nasa.gov/citations/20170006615) |
| `ntrs-20170007283` | SAME | 2 | [NTRS 20170007283: Spacecraft Fire Safety Research at NASA Glenn Research Center](https://ntrs.nasa.gov/citations/20170007283) |
| `ntrs-20170009141` | ACME-BRE | 1 | [NTRS 20170009141: Emulation of Condensed Fuel Flames Using a Burning Rate Emulator (BRE) in Microgravity](https://ntrs.nasa.gov/citations/20170009141) |
| `ntrs-20180005168` | Saffire-I | 3 | [NTRS 20180005168: Saffire: A Novel Approach to Study of Spacecraft Fire Safety Using Un-Manned Spacecraft](https://ntrs.nasa.gov/citations/20180005168) |
| `ntrs-20200000557` | Saffire-II | 3 | [NTRS 20200000557: Buoyancy Effects on Concurrent Flame Spread Over Thick PMMA](https://ntrs.nasa.gov/citations/20200000557) |
| `ntrs-20205008449` | CFI | 3 | [NTRS 20205008449: Effects of Ambient Inert Gas Properties on Cool-Flame Combustion of Normal-Alkane Droplets in Microgravity](https://ntrs.nasa.gov/citations/20205008449) |
| `ntrs-20210011385` | BASS, BASS-II | 3 | [NTRS 20210011385: Burning and Suppression of Solids–II (BASS-II) Summary Report](https://ntrs.nasa.gov/citations/20210011385) |
| `ntrs-20210015913` | ACME-CFI-G | 2 | [NTRS 20210015913: Advanced Combustion via Microgravity Experiments (ACME) on the International Space Station (ISS)](https://ntrs.nasa.gov/citations/20210015913) |
| `ntrs-20210017780` | context | 1 | [NTRS 20210017780: Fire Safety Implications of Preliminary Results from Saffire IV and V Experiments on Large Scale Spacecraft Fires](https://ntrs.nasa.gov/citations/20210017780) |
| `ntrs-20210020516` | context | 1 | [NTRS 20210020516: Fire on the Moon: Solid Fuel Combustion Experiments](https://ntrs.nasa.gov/citations/20210020516) |
| `ntrs-20220007191` | ACME-E-FIELD | 1 | [NTRS 20220007191: Laminar Non-Premixed Flames of Gaseous Fuel Aboard the International Space Station](https://ntrs.nasa.gov/citations/20220007191) |
| `ntrs-20220009536` | context | 0 | [NTRS 20220009536: Validation of Decompression Sickness Risk Mitigation Protocols for Planetary Spaceflight Missions](https://ntrs.nasa.gov/citations/20220009536) |
| `ntrs-20220015583` | ACME-CFI-G | 1 | [NTRS 20220015583: ACME: Advanced Combustion via Microgravity Experiments](https://ntrs.nasa.gov/citations/20220015583) |
| `ntrs-20240003211` | context | 0 | [NTRS 20240003211: Moon to Mars (M2M): Exploration Atmosphere](https://ntrs.nasa.gov/citations/20240003211) |
| `ntrs-20240013238` | context | 0 | [NTRS 20240013238: Nasa Exploration Atmosphere Tests 3 & 4: Development and Validation of Planetary Extravehicular Activity Prebreathe Protocols for Alternate Atmospheres and Suit Pressures](https://ntrs.nasa.gov/citations/20240013238) |
| `ntrs-20250001364` | CFI | 1 | [NTRS 20250001364: Fire and Flame Research in the International Space Station’s Combustion Integrated Rack](https://ntrs.nasa.gov/citations/20250001364) |
| `ntrs-20250010653` | context | 1 | [NTRS 20250010653: Lunar Combustion Investigation: Flammability Results from a Rotating Sounding Rocket](https://ntrs.nasa.gov/citations/20250010653) |
| `ntrs-20260002050` | context | 0 | [NTRS 20260002050: Surface Vehicle Atmospheric Considerations for Moon to Mars Exploration](https://ntrs.nasa.gov/citations/20260002050) |
| `ntrs-20260003925` | context | 1 | [NTRS 20260003925: Impacts of Reduced Pressure Atmospheres on Environmental Control and Life Support Systems (ECLSS) Architectures](https://ntrs.nasa.gov/citations/20260003925) |
| `psi-100` | Saffire-III | 4 | [PSI-100 investigation page (SAFFIRE-III)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-100) |
| `psi-101` | SAME-R | 4 | [PSI-101 investigation page (SAME-R)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-101) |
| `psi-102` | SAME | 4 | [PSI-102 investigation page (SAME)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-102) |
| `psi-106` | SLICE | 2 | [PSI-106 investigation page (SLICE)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-106) |
| `psi-107` | SPICE | 3 | [PSI-107 investigation page (SPICE)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-107) |
| `psi-159` | ACME-CFI-G | 3 | [PSI-159 investigation page (ACME CFI-G)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-159) |
| `psi-20` | ACME-BRE | 5 | [PSI-20 investigation page (ACME BRE)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-20) |
| `psi-22` | ACME-E-FIELD | 4 | [PSI-22 investigation page (ACME E-FIELD Flames)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-22) |
| `psi-25` | BASS-II | 5 | [PSI-25 investigation page (BASS-II)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-25) |
| `psi-26` | BASS | 6 | [PSI-26 investigation page (BASS)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-26) |
| `psi-39` | CFI | 2 | [PSI-39 investigation page (CFI)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-39) |
| `psi-68` | FLEX-2 | 4 | [PSI-68 investigation page (FLEX-2)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-68) |
| `psi-69` | FLEX | 5 | [PSI-69 investigation page (FLEX)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-69) |
| `psi-98` | Saffire-I | 4 | [PSI-98 investigation page (SAFFIRE-I)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-98) |
| `psi-99` | Saffire-II | 3 | [PSI-99 investigation page (SAFFIRE-II)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-99) |

Sources with 0 claims were fetched and read but yielded no claim (or are used only in `missions.json` / `history.json`).

## missions.json

- [NASA OCHMO-TB-003 Habitable Atmosphere (NASA-STD-3001 technical brief)](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf) (used by `iss`)
- [Houston We Have a Podcast: Recycling Water and Air (ISS ECLSS, 14.7 psi)](https://www.nasa.gov/podcasts/houston-we-have-a-podcast/recycling-water-and-air/) (used by `iss`)
- [NTRS 19990053973 – Flow Effects on the Flammability Diagrams of Solid Fuels (ventilation ~0.1 m/s)](https://ntrs.nasa.gov/citations/19990053973) (used by `iss`)
- [NTRS 20050199446 – TIGER Burned Brightly in JAMIC (ventilation: a few cm/s)](https://ntrs.nasa.gov/citations/20050199446) (used by `iss`)
- [NTRS 20090012334 – Pressure Effects on the Self-Extinguishment Limits of Aerospace Materials (Orion CM)](https://ntrs.nasa.gov/citations/20090012334) (used by `spacecraft`)
- [NTRS 20240003211 – Moon to Mars (M2M): Exploration Atmosphere](https://ntrs.nasa.gov/citations/20240003211) (used by `spacecraft`)
- [NASA – Life Encapsulated: Inside NASA's Orion for Artemis II](https://www.nasa.gov/humans-in-space/life-encapsulated-inside-nasas-orion-for-artemis-ii-moon-mission/) (used by `spacecraft`)
- [NTRS 20220009536 – Validation of DCS Risk Mitigation Protocols for Planetary Spaceflight Missions (56.5 kPa, 34% O2)](https://ntrs.nasa.gov/citations/20220009536) (used by `lunar-base`)
- [NTRS 20150021491 – Evidence Report: Risk of Hypobaric Hypoxia from the Exploration Atmosphere](https://ntrs.nasa.gov/citations/20150021491) (used by `lunar-base`)
- [NTRS 20260002050 – Surface Vehicle Atmospheric Considerations for Moon to Mars Exploration](https://ntrs.nasa.gov/citations/20260002050) (used by `lunar-base`)
- [NTRS 20240013238 – NASA Exploration Atmosphere Tests 3 & 4 (alternate 66.2 kPa / 28.5% O2)](https://ntrs.nasa.gov/citations/20240013238) (used by `lunar-base`)
- [NTRS 20260003925 – Impacts of Reduced Pressure Atmospheres on ECLSS Architectures (10.2 vs 8.2 psia)](https://ntrs.nasa.gov/citations/20260003925) (used by `lunar-rover`)
- [NTRS 20050217475 – Fingering flamelets (ventilation turned off to extinguish fires)](https://ntrs.nasa.gov/citations/20050217475) (used by `lunar-rover`)
- [Houston We Have a Podcast: Artemis Spacesuits (pure oxygen suits)](https://www.nasa.gov/podcasts/houston-we-have-a-podcast/artemis-spacesuits/) (used by `eva-suit`)

## earth.json (Back to Earth)

- [NASA Spinoff – Fireman's Air Tanks](https://spinoff.nasa.gov/node/9582) (used by `firemans-air-tanks`)
- [NASA Spinoff – Fire Detector (Brunswick Incipient Fire Detector)](https://spinoff.nasa.gov/node/9407) (used by `fire-detector`)
- [PSI-102 SAME investigation page (research impacts)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-102) (used by `fire-detector`)
- [PSI-101 SAME-R investigation page](https://psi.nasa.gov/physci/repo/data/investigations/PSI-101) (used by `fire-detector`)
- [NASA Spinoff – New Technology for the Fire Attire](https://spinoff.nasa.gov/node/9918) (used by `fire-attire`)
- [NASA Spinoff 2008 – Polymer Fabric Protects Firefighters, Military, and Civilians (PBI)](https://spinoff.nasa.gov/Spinoff2008/ps_3.html) (used by `fire-attire`)
- [NASA Spinoff 2020 – Zero-Leak Valve Holds Tight in Demanding Environments](https://spinoff.nasa.gov/Spinoff2020/ip_5.html) (used by `water-mist`)
- [PSI-69 FLEX investigation page (research impacts)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-69) (used by `water-mist`)
- [NTRS 20090014812 – MDCA Flame Extinguishment Experiment](https://ntrs.nasa.gov/citations/20090014812) (used by `water-mist`)
- [NASA Spinoff 2020 – Wool Mask to Fight Fires in Space Inspires Fire Equipment on Earth](https://spinoff.nasa.gov/Spinoff2020/ps_4.html) (used by `wool-respirator`)
- [PSI-25 BASS-II investigation page (research impacts)](https://psi.nasa.gov/physci/repo/data/investigations/PSI-25) (used by `bass-flammability-models`)
- [PSI-26 BASS investigation page](https://psi.nasa.gov/physci/repo/data/investigations/PSI-26) (used by `bass-flammability-models`)
- [PSI-98 Saffire-I investigation page](https://psi.nasa.gov/physci/repo/data/investigations/PSI-98) (used by `saffire-sealed-spaces`)

## history.json

- [NASA – Apollo 1 mission page](https://www.nasa.gov/mission/apollo-1/) (used by `apollo-1`)
- [NASA Spinoff 2008 – Polymer Fabric Protects Firefighters (Apollo 1 review recommendations)](https://spinoff.nasa.gov/Spinoff2008/ps_3.html) (used by `apollo-1`)
- [NASA OCHMO-TB-003 Habitable Atmosphere (60% O2 / 40% N2 ground procedures after Apollo 1)](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf) (used by `apollo-1`)
- [Report of Apollo 13 Review Board (NSSDCA text)](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_13_review_board.txt) (used by `apollo-13`)
- [NTRS 20110015690 – A Case Study of the Failure on Apollo 13](https://ntrs.nasa.gov/citations/20110015690) (used by `apollo-13`)
- [NASA History – 25 Years Ago: Fire Aboard Space Station Mir](https://www.nasa.gov/history/25-years-ago-fire-aboard-space-station-mir/) (used by `mir-fire`)
- [NTRS 20180005168 – Saffire: A Novel Approach to Study of Spacecraft Fire Safety Using Un-Manned Spacecraft](https://ntrs.nasa.gov/citations/20180005168) (used by `saffire`)
- [NTRS 20150000894 – Large-Scale Spacecraft Fire Safety Tests](https://ntrs.nasa.gov/citations/20150000894) (used by `saffire`)
- [NTRS 20210017780 – Fire Safety Implications of Preliminary Results from Saffire IV and V](https://ntrs.nasa.gov/citations/20210017780) (used by `saffire`)
- [PSI-98 Saffire-I investigation page](https://psi.nasa.gov/physci/repo/data/investigations/PSI-98) (used by `saffire`)
- [NTRS 20250010653 – Lunar Combustion Investigation: Flammability Results from a Rotating Sounding Rocket](https://ntrs.nasa.gov/citations/20250010653) (used by `luci-partial-gravity`)
- [NTRS 20210020516 – Fire on the Moon: Solid Fuel Combustion Experiments](https://ntrs.nasa.gov/citations/20210020516) (used by `luci-partial-gravity`)

## Searched but not used

- **Artemis II smoke/fire alarm (April 2026)**: covered by non-NASA outlets (e.g. spacepolicyonline.com, CBC, Lockheed Martin feature). We found no NASA page that describes it (32 April 2026 posts on the NASA Artemis/missions blogs checked, plus the Artemis II press kit), so it is left out of `history.json`.
- **Numeric cabin ventilation velocity requirement**: NASA-STD-3001 Vol. 2 (Rev A, and the OCHMO-TB-003 brief) requires ventilation without giving a velocity in the text we checked. The 5–20 cm/s band in `missions.json` is marked as an assumption and backed only by NTRS descriptions ('of the order of 0.1 m/s', 'a few centimeters per second').
- **Orion nominal Artemis cabin atmosphere**: no NASA page we found states the numbers (a NASA podcast gives 14.7 psi / 79% N2 / 20% O2, but for ISS). `spacecraft` is therefore `assumption: true`.
- **Pressurized-rover atmosphere**: NASA has published no rover specification. 30% / 10.2 psia comes from the challenge brief and NASA's materials certification condition (NTRS 20090012334). `assumption: true`.
- NTRS has little abstract-level text for FLEX-2, ACME CFI-G, ACME E-FIELD and SLICE results, so their claims rely mostly on PSI records (objectives and approach rather than results).
