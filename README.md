# Wind farm digital twin on Microsoft Fabric

An end-to-end demo that starts at a wind farm's edge server and ends in a live 3D digital twin with agents, built in phases. It reconstructs, from scratch, the kind of solution shown in Microsoft's "real-time 3D digital twin built on Microsoft Fabric" demo, and places it in an Azure IoT Operations architecture.

**Phase 1** is the ground everything stands on: an Azure VM as the edge server, Azure IoT Operations, a turbine simulator with fault injection, ingestion into a Fabric eventstream, Eventhouse and Lakehouse, and the data that the questions of a wind farm's staff need: two years of operating history, a forecast, a budget, contracts and reference data. **Phase 2** adds a star schema, a semantic model and a report; **Phase 3** a data agent, an ontology and an operations agent; **Phase 4** the 3D twin itself, as a Fabric app built with Rayfin. Phases 1 to 3 have been deployed; Phase 4 runs on sample data and has not met Fabric yet.

```
Edge server (Azure VM, K3s, Azure Arc)                Microsoft Fabric
+----------------------------------------+            +---------------------------------------+
| Turbine simulator --MQTT--> Azure IoT   |   Kafka    | Eventstream --> Eventhouse (KQL)      |
|                             Operations  | ---------> |                   | OneLake           |
|                             data flow   |            |                   v availability      |
| Site documents --> reference data sync  | ---------> | Lakehouse: live shortcuts, reference  |
+----------------------------------------+  OneLake   | tables, operating history, forecast   |
                                                      +---------------------------------------+
```

The site, Northwind Ridge Wind Farm, is fictional: 12 turbines of 4.2 MW on procedurally generated terrain. The history, the live data and the forecast share one weather and the same twelve machines, so that a question can combine "now" with "normally". All data is synthetic; the companies and people are invented.

## Status

| Part | State |
|---|---|
| Phase 1, edge to Fabric, steps 1 to 8 of the deployment guide | Deployed live twice in November 2026: the first version of this repository on the 19th, this version on the 20th. 20 obstacles were met in the two runs; all are addressed except two open questions (see the validation log). |
| Simulator 1.1.0, history generator, site generator | 57 automated tests; the simulator ran live in the second deployment |
| Notebooks 01 to 04 and the question bank | Run in local Spark sessions on the versions of both Fabric runtimes, and in Fabric in the second deployment, where the checks matched the guide (reported by the user) |
| KQL added since the first run (`ActiveAlarms()`, four live questions) | Syntax-checked; a run in the Eventhouse is not confirmed |
| `infra/vm.sh`, `infra/rebuild-env.sh` | 30 scenario tests against stand-in commands. Live: `run` works; `ssh` found no way in when the SSH rule had been removed, cause open |
| `infra/99-cleanup.sh` | 30 scenario tests. Run live once, in its first version: Fabric items and resource group removed; the uninstall step failed and now retries |
| Checks added after the second deployment (object ID format, step 3 feature check, longer health wait in step 4, `ssh` falling back to `run`) | Scenario tests and ShellCheck; not yet run against Azure |
| Phase 2: prepared views, model tables, semantic model, acceptance test, report | Deployed once, on 20 November 2026; three obstacles, all fixed. The user reported every step as done; the outputs of the acceptance test and of the report were not sent, so the measures and the report count as run, not as verified. See [docs/phase2-validation-log.md](docs/phase2-validation-log.md) |
| Phase 3: data agent, its test, ontology, operations agent | Deployed on the user's tenant on 21 November 2026. The data agent was built and tested six times: about 39 of 52 test questions pass by the judge of the SDK. The ontology was created, and measured to make the agent worse, so the agent runs without it. The operations agent was set up; its playbook and its Teams message were reported, not seen. Seven obstacles, all in [docs/phase3-validation-log.md](docs/phase3-validation-log.md) |
| Phase 4: the twin as a Fabric app (`app/`) | Built on 21 November 2026, the exploded view of a turbine on 22 November; **not deployed yet**. The 3D scene, the panels and the simulation run: open `app/preview/windfarm-twin-preview.html`. The app was compiled, built and linted inside Microsoft's template for Rayfin 2.0.1; 60 tests cover its functions against stand-ins for Fabric, its simulation and its components against the reference data. Which token the Eventhouse accepts from an app is open until the first deployment. See [docs/phase4-validation-log.md](docs/phase4-validation-log.md) |
| Phases 4 and 5 | Planned; see the roadmap |

"What has and has not been verified" in [docs/00-architecture.md](docs/00-architecture.md) has the details.

## Start here

| Document | Purpose |
|---|---|
| [docs/01-deployment-guide-phase1.md](docs/01-deployment-guide-phase1.md) | Step-by-step deployment from an empty subscription and workspace |
| [docs/07-deployment-guide-phase2.md](docs/07-deployment-guide-phase2.md) | Phase 2: prepared views, model tables, semantic model, its test, and a report |
| [docs/08-semantic-model.md](docs/08-semantic-model.md) | The model's tables, relationships and 39 measures with their DAX |
| [docs/09-deployment-guide-phase3.md](docs/09-deployment-guide-phase3.md) | Phase 3: data agent and its test, ontology, operations agent, and how to show them |
| [docs/10-ontology.md](docs/10-ontology.md) | The ontology's entity types, properties and relationships with the tables behind them |
| [docs/11-deployment-guide-phase4.md](docs/11-deployment-guide-phase4.md) | Phase 4: create the Fabric app, deploy it, check its connections, show it |
| [app/README.md](app/README.md) | The twin: what is in the folder, how it gets its values, what the picture means |
| [docs/06-upgrade-from-first-delivery.md](docs/06-upgrade-from-first-delivery.md) | Bring a deployment of the first version up to this one |
| [docs/02-demo-runbook.md](docs/02-demo-runbook.md) | How to inject a fault, what to show, and the story in the history behind it |
| [docs/04-use-cases-and-data-audit.md](docs/04-use-cases-and-data-audit.md) | Who asks what at a wind farm, how the measures are defined, which data answers which question, and what is not modelled |
| [docs/05-question-bank.md](docs/05-question-bank.md) | 43 questions from six roles; [docs/question-bank-example-answers.md](docs/question-bank-example-answers.md) shows the answers for one run |
| [docs/00-architecture.md](docs/00-architecture.md) | The whole solution across all phases, design decisions, security, what was verified |
| [docs/data-contracts.md](docs/data-contracts.md) | Topics, message formats, commands, reference files, history tables column by column |
| [docs/troubleshooting.md](docs/troubleshooting.md) | What to check when a step does not behave as described |
| [docs/03-roadmap.md](docs/03-roadmap.md) | Phases 4 and 5, and what Phases 2 and 3 delivered |
| [docs/phase1-validation-log.md](docs/phase1-validation-log.md), [docs/phase2-validation-log.md](docs/phase2-validation-log.md), [docs/phase3-validation-log.md](docs/phase3-validation-log.md), [docs/phase4-validation-log.md](docs/phase4-validation-log.md) | The obstacles of the live deployments and what was changed for each; for Phase 3, what was checked before its first run |

## Repository layout

| Path | Content |
|---|---|
| `config/` | `demo.env.example`, the one configuration file all scripts read |
| `infra/` | Scripts that run on your workstation: create the VM, deploy Azure IoT Operations, connect the edge to Fabric; `vm.sh` to start, stop, reach and update the VM; `rebuild-env.sh` to rebuild the settings file from what is deployed; `99-cleanup.sh` to remove a deployment |
| `edge/scripts/` | Scripts that run on the edge VM, started from the workstation through `infra/vm.sh ssh`: prepare the host, connect to Azure Arc, deploy the simulator, sync reference data, control the simulator |
| `edge/k8s/` | Kubernetes manifests for the simulator and a diagnostic MQTT client |
| `edge/dataflows/` | The Azure IoT Operations data flow definition |
| `edge/reference-sync/` | Uploads reference files to OneLake |
| `simulator/` | The turbine simulator, the climate model, the history generator and the site generator (Python), their tests and the Dockerfile |
| `data/reference/` | Generated site definition, master data, contracts, people, GIS layers and terrain |
| `data/sop/` | Operating procedures |
| `data/samples/` | 45 minutes of sample messages with one gearbox fault, and its ground truth |
| `fabric/kql/` | Eventhouse tables, update policies, OneLake availability, validation queries, live questions |
| `fabric/notebooks/` | Eleven notebooks. 01 to 04, Phase 1: load the reference tables, generate the history, refresh the forecast, answer the question bank. 05 to 08, Phase 2: model tables, semantic model, its test, report. 09 to 11, Phase 3: build the data agent, test it, build the ontology |
| `fabric/data-agent/`, `fabric/ontology/`, `fabric/operations-agent/` | Phase 3: the data agent's instructions and example queries, the ontology's definition, the operations agent's goals and instructions. Generated from `tools/agent_spec.py` |
| `app/` | Phase 4: the twin. `overlay/` holds the page (React, Three.js) and the seven functions; `create-app.sh` puts them on Microsoft's Rayfin template; `create-principal.sh` sets up the service principal for real-time values; `preview/` is the twin on sample data in one file; `test/` the tests of its code |
| `tools/` | Builds the notebooks from their sources; the question bank; the semantic model's definition (`model_spec.py`) and the builder of the Phase 2 notebooks; the definition of the agents and the ontology (`agent_spec.py`), the builder of the Phase 3 files and the check of the T-SQL example queries; local Spark runs of the notebooks; offline KQL syntax check; guards and scenario tests for the shell scripts |

## The demo in one minute

On the workstation, in the root folder of the repository:

```bash
./infra/vm.sh ssh bash ./edge/scripts/simctl.sh wind --mean 11 --duration 60m
./infra/vm.sh ssh bash ./edge/scripts/inject-anomaly.sh     # gearbox degradation on WT-07, clears by itself after 15 minutes
```

In Fabric, the validation queries show WT-07's gearbox vibration and oil temperature pulling away from its neighbours, the alarms, the controller derating the turbine, the production gap, and the return to normal. The question bank then shows that this was coming: four months of drift, rising iron in the oil, the same failure on WT-02 a year earlier, an inspection planned in two weeks and a warranty that ends on 31 December.

## Try it without Azure and Fabric

```bash
cd simulator
pip install -r requirements-dev.txt
python -m pytest                                                              # 86 tests
SITE_FILE=../data/reference/site.json SINK=stdout python -m windfarm_sim | head -n 20   # live messages
python -m windfarm_sim.history --site ../data/reference/site.json --out /tmp/history    # two years of history as CSV
cd .. && bash tools/script-tests/run.sh                                       # the shell scripts against stand-in commands
explorer.exe app/preview    # on WSL: then open windfarm-twin-preview.html, the 3D twin on sample data
```

See [simulator/README.md](simulator/README.md).
