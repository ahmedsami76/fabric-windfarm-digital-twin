# Roadmap

Phase 1 is in this repository. The later phases are planned below, each with what it delivers, what it depends on and the decisions still open. Product facts were checked against the Microsoft Fabric documentation in November 2026; several of these features are in preview and may change.

| Phase | Delivers | State |
|---|---|---|
| 1. Edge to Eventhouse and Lakehouse | Edge VM, Azure IoT Operations, simulator with fault injection, eventstream, Eventhouse, Lakehouse, reference data, two years of operating history, forecast, question bank | Built. The edge-to-Fabric path was run live once; the history and the helper scripts added afterwards were tested without Azure and Fabric. |
| 2. Prepare and model | Enriched tables and KQL views, semantic model | Planned |
| 3. Ontology and agents | Data agent with a test, ontology, operations agent that detects the fault | Delivered; deployed on 21 November 2026 |
| 4. Rayfin app | 3D digital twin with live data and chat | Planned |
| 5. Remediation with approval | Operations agent proposes a fix, an engineer approves, the edge applies it | Planned |

## Phase 2: Prepare and model

**Built and deployed once on 20 November 2026.** [07-deployment-guide-phase2.md](07-deployment-guide-phase2.md) is its guide, [phase2-validation-log.md](phase2-validation-log.md) the record of that run and of what is still to confirm.

**Delivered**

- KQL functions in the Eventhouse: `Scada10Min()` with the columns and definitions of `ops_scada_10min`, `AlarmIntervals()`, `GearboxVsFleet()`.
- One continuous 10-minute series, `fact_scada_10min`: the generated history, with complete live periods on top.
- A notebook that builds the star schema in the Lakehouse: dates, turbines, site, and nine fact tables.
- A Direct Lake semantic model with 12 relationships and 39 measures, built by a notebook from `tools/model_spec.py`, and a notebook that tests it against the Lakehouse for eleven questions of the question bank.
- A three-page Power BI report, built by a notebook.

**Different from the plan**

- The live roll-up for the model runs in Spark, not as a KQL materialized view; the reasons are in the guide's design decisions.
- The model is kept as Python data, not as TMDL.
- Contractual availability (AM-03) is not a measure; it goes to Phase 3 as a reference query.
- Not delivered: dimension tables for components, alarm codes and contracts; a Real-Time Dashboard. They can be added when Phase 3 needs them.

**Still open**

- The Lakehouse shortcuts to the Eventhouse use passthrough identity. The model no longer depends on them, because notebook 05 copies the live data into Lakehouse tables. The question remains for the data agent and the app if they read the shortcuts.
- `Scada10Min()` in KQL and the roll-up in notebook 05 implement the same rules twice; nothing compares their results yet.

## Phase 3: Ontology and agents

**Delivered and deployed on 21 November 2026.** [09-deployment-guide-phase3.md](09-deployment-guide-phase3.md) is its guide, [phase3-validation-log.md](phase3-validation-log.md) the record of the deployment: seven obstacles and six test runs of the data agent.

**Delivered**

- A data agent on the Lakehouse (history, T-SQL) and the KQL database (live, KQL), built by a notebook: instructions with the site's definitions, 34 T-SQL and 6 KQL example queries, each run against the data before it is used.
- A notebook that asks the agent 52 questions and has each answer judged against the result of a reference query: 34 that are example queries, 10 variations of them, 5 without an example and 3 the data cannot answer. The 4 live questions are asked and printed.
- An ontology of 10 entity types and 12 relationship types, built by a notebook from a definition, bound to Lakehouse tables, with the turbine's live signals from the Eventhouse.
- An operations agent on the live telemetry: goals, instructions and three threshold rules, with an optional fourth on a new table that compares each turbine with the fleet as the data arrives.
- A demonstration the plan did not have: a fault of severity 0.2, which the turbine controller does not report and the agent does.

**Different from the plan**

- The ontology is not generated from the semantic model. Entity types generated that way are, as far as the documentation shows, bound to the model, and a data agent does not work with such bindings (a known issue on Microsoft Learn). It is built from a definition and bound to the tables.
- The data agent reads the Lakehouse tables, not the semantic model and not, by default, the ontology. The guide's design decisions give the reasons; attaching the ontology was measured on 21 November 2026: 39 and 40 of 52 questions passed without it, 32 to 33 with it, so the agent runs without it.
- The example queries are written by hand in T-SQL: a mechanical translation from Spark SQL left functions that T-SQL does not have. There were 13 at first. The first test showed that the agent answers correctly where it has an example and mostly wrongly where it has only instructions, so there are now 34, and the test asks ten variations of them.
- The operations agent reads the KQL database, not the ontology: with an ontology as source it takes no rule with "and" and no aggregation.
- The agent's message carries the live evidence. The history behind it (the four-month drift, the oil samples, the precedent on WT-02, the warranty date) comes from the data agent, in the same demonstration, not from the operations agent itself.
- Contractual availability (AM-03) is a question of the test, not an example query.

**Still open**

- Not seen: the ontology in the portal, the playbook of the operations agent and its Teams message. Not run: the optional fleet rule with its update policy. The guide lists both under "What was and was not tested".
- The data agent answers about 39 of 52 test questions correctly by the judge of the SDK, and four or five wrongly by my reading. It is good enough to show with questions tried beforehand, not good enough to trust unseen.
- An operations agent looks every 5 minutes and the controller reacts in seconds, so for a full fault the agent is not earlier than the alarm. The early warning shows only for a small or slow fault.
- `infra/99-cleanup.sh` does not delete the items of Phases 2 and 3 by name.
- Publishing the data agent to Microsoft 365 Copilot or Teams, and calling it from the app of Phase 4 through its MCP address.

## Phase 4: Rayfin app

**Delivers**

- A Fabric app created with the Rayfin CLI: React and Three.js front end, hosted in the workspace with Fabric sign-in.
- Procedural terrain built from `reference/terrain/heightmap.json`, roads and infrastructure from the GIS layers, and a turbine model placed at each registry position, with rotors turning at the reported speed and nacelles facing the reported direction.
- Site panel (production, wind, alarms), turbine panel with live values, and a component view per turbine.
- A chat panel that sends questions to the data agent.

**Open decision: how the app reads live data.** Rayfin connectors give typed access to a Lakehouse SQL analytics endpoint, a warehouse, a SQL database in Fabric and a semantic model. There is no connector for a KQL database. The options are:

| Option | Freshness | Notes |
|---|---|---|
| Rayfin Functions that query the Eventhouse with the app identity | Seconds | Server-side code; the functions feature of the CLI is in preview |
| Semantic model connector (DAX `executeQuery`) | As fresh as the model | Simple; reuses the Phase 2 measures |
| Lakehouse SQL endpoint over the shortcuts | About 5 minutes behind | Simple; fine for history, not for live values |

The likely answer is a mix: Functions for live values and alarms, the semantic model for KPIs.

## Phase 5: Remediation with approval

**Delivers**

- The fault is injected with `--hold`, so it stays until something is done about it.
- The operations agent gathers the evidence that SOP-GBX-001 asks for, proposes an action (for example, curtail WT-07 to 30% for 15 minutes) and sends it to the on-call engineer in Teams with the cost of acting and of not acting. The cost comes from the data: the forecast and the contract price for the energy, the precedent on WT-02 for the repair.
- After approval, the action runs: a Power Automate flow or a Fabric notebook writes a command event to an eventstream. An Azure IoT Operations data flow, with that eventstream's custom endpoint as its Kafka source, publishes the command to the edge topic `…/_control/request`, and the simulator applies it.
- The agent confirms from telemetry that the action took effect, reviews at the review time, and records the event in a work order table.

**To be proven.** The cloud-to-edge path is a design built from documented parts (an eventstream custom endpoint as destination, a Kafka endpoint as data flow source). It has not been built yet.

## Further options

- Voice questions in the app, as in the original demo video, with a real-time speech model in Microsoft Foundry.
- Real terrain from open LiDAR data instead of the procedural site.
- An OPC UA server in front of the simulator and the Azure IoT Operations connector for OPC UA, with assets registered in Azure Device Registry.
- Secure settings for Azure IoT Operations (Key Vault secret sync, user-assigned identities) and broker authorization policies.
- More than one site, to show fleet-level comparison.
- A site meter with electrical losses, a condition monitoring system with vibration spectra, and safety records: the data sets that [04-use-cases-and-data-audit.md](04-use-cases-and-data-audit.md) lists as not modelled.
- The Eventhouse destination of the eventstream created through the Fabric REST API instead of the Get data wizard, which would remove the one manual choice that can break the data model (step 6.7).
