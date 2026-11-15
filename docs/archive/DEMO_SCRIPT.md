# EMBER demo script (≈ 2 min)

Follows section 13 of the concept. Before recording, open the deployed site in a clean browser and set the zoom to 110 %.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:12 | Footage of a candle in a falling jar, or the Apollo 1 / Mir cards on the home page | "In 1967 a cabin fire killed three astronauts. In 1997 a fire filled Mir with smoke. In space a flame behaves differently: no buoyancy, no updraft." |
| 0:12–0:25 | The PSI website, then EMBER's home page | "NASA has flown dozens of fire experiments, and the data is public. But it's scattered across PSI, hard to compare and harder to interpret." |
| 0:25–0:45 | Mission lens: click **Pressurized lunar rover** (30 % O₂, 10.2 psi), keep "Cabin lining material, solid" | "I'm choosing a cabin lining for a lunar rover. EMBER ranks 15 NASA investigations for my conditions. The formula is transparent: safety consequence × evidence strength × proximity. I can change the weights." |
| 0:45–1:00 | Open the BASS-II card, then **Why this score** | "Every card has the same layout: fuel, O₂, flow, hardware, findings, each with a source link. Here: flames survive at flows below 1 cm/s and flare up when the flow increases." |
| 1:00–1:20 | What-if: start at 21 %, 101 kPa (status **Measured**), then drag O₂ to 30 % and pressure to 70 kPa | "At ISS conditions this point was measured. Now I move to lunar conditions and the status changes to **Extrapolated**. The nearest solid-material flight test stops at 23 % O₂ and one atmosphere. Nobody has flown this." |
| 1:20–1:35 | Gravity bracket: the literature O₂ margin box | "For lunar gravity there's no flight data at all. EMBER shows a bracket labelled as an estimate: NASA found materials burn at up to 4 % lower oxygen in microgravity than the standard Earth test suggests." |
| 1:35–1:50 | Trust page | "We test ourselves, always against a baseline. Inside one experiment EMBER predicts 77 % of hidden tests, against 54 % for guessing. Across experiments it is barely better than guessing, and that is the point: the results don't transfer, and EMBER marked 77 % of those wrong answers as Extrapolated before we checked." |
| 1:50–2:00 | Back to Earth, then the final slogan | "These findings also reach Earth, in smoke detectors and firefighter air tanks. EMBER shows what NASA knows about fire in space, and what nobody knows yet." |

**Backup if the network is down:** run `cd web && npm run build && npx vite preview`. All data is bundled locally.
