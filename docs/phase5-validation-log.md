# Phase 5 validation log

The record of Phase 5, remediation with approval. It is delivered in three steps, each run on the tenant before the next is built: 5a the command path from Fabric to the edge, 5b the approval through the operations agent, 5c the confirmation and the record. 5a was written on 23 November 2026 and first run on 24 November: the notebook got as far as the send (obstacle A), and after the correction the run was reported as working. 5b was built on 24 November and has not run.

As in the Phase 4 log, three words are used strictly. **Seen**: the user sent me the output or the screen. **Reported**: the user said so. **Not run**: nobody has run it.

## Progress of 5a

| Step of the guide ([12-deployment-guide-phase5a.md](12-deployment-guide-phase5a.md)) | Result | Notes |
|---|---|---|
| 1. Create the command path | Done at least in part; output not seen | Reported by its result: on 24 November the notebook found the eventstream `WindFarmCommands` (`2dd1b79f-39e7-44c6-8702-d0cdece97787`) with a custom endpoint as source. Not known: whether the script created it from the definition or it was made by hand; whether the endpoint and the data flow on the edge were created |
| 2. Import the notebook | Done | Seen: the export of the notebook after its run. It is the second issue of 23 November |
| 3. Watch the control topic | Not known | Nothing sent |
| 4. Send a command | 24 November, 19:15 Houston: stopped at the send | Seen. The install cell, the parameter cell, the command (`curtail` WT-07, 30 percent, 10m, request `71906921a818`, requested by `MOD Administrator`) and the lookup (`Writes to esehdmfhbid5s2gzsq4rcp.servicebus.windows.net, event hub esehdmfhbid5s2gzsq4rcp_eh`) all worked. The last cell: `ImportError: Please install websocket-client library to use sync websocket transport.` Obstacle A |
| 4, again, and 5. See it take effect | 24 November, between 19:20 and 19:45 Houston: **reported as working** | Reported, in four words: "Worked: WT-07 curtailed", as the answer to my question what the run did after the correction. Not seen: the notebook's output, the messages on the control topic, the rows of the query, the two times I had asked for |
| 6. Release | Not known | |

## Progress of 5b

Guide: [13-deployment-guide-phase5b.md](13-deployment-guide-phase5b.md), written on 24 November 2026, 20:30 Houston.

| Step of the guide | Result | Notes |
|---|---|---|
| 1. The table the agent decides on | Not run | The KQL passed a syntax check. An update policy of the same form was delivered in Phase 3 (`GearboxVsFleetLive`) and I never saw it run either |
| 2. Replace the notebook | Not run | |
| 3. Rehearse the action without the agent | Not run | The first run of the notebook as a job, of pip as a plain command in Fabric, and of the Job Scheduler call from the workstation |
| 4. Give the agent its instructions and the action | Not run | The first call of the operations agent's definition API from this repository |
| 5. Generate the playbook and start the agent | Not run | I have not seen a generated playbook in Phase 3 either |
| 6. Show it | Not run | |
| 7. After the run | Not run | |

## Found before the first run of 5a

| # | What I had planned or said | What is true | Source | Changed |
|---|---|---|---|---|
| 1 | "The operations experience cannot create a data flow with a Kafka source, Kubernetes or Bicep can", so the data flow would be a Kubernetes manifest applied on the VM (roadmap, 23 November) | The Azure CLI can as well. `az iot ops dataflow apply --config-file` checks that a Kafka source endpoint has a consumer group and that the other side is the local broker, and sends the data flow; `az iot ops dataflow endpoint create fabric-realtime` has `--group-id`. Microsoft's page names only Kubernetes and Bicep | Source of the extension `azure-iot-ops` 2.11.2 (`providers/orchestration/resources/dataflows.py`, `params.py`); "Configure Azure Event Hubs and Kafka data flow endpoints" on Learn | The script uses the same two commands as step 6 of Phase 1, from the workstation. No manifest, nothing to run on the VM. **Unproven** that the service accepts from the CLI what the CLI is willing to send |
| 2 | The user copies bootstrap server, topic and consumer group from the portal into `config/demo.env`, as in Phase 1 | The Fabric API returns them: `GET …/eventstreams/{id}/destinations/{id}/connection` gives the namespace, the event hub name and the consumer group of a custom endpoint | Fabric REST reference, "Topology - Get Eventstream Destination Connection" | The script reads them. Three values less to copy, and none of the copy mistakes of Phase 1 |
| 3 | The eventstream is made in the portal, with pictures, as in Phase 1 | An eventstream can be created from a definition through the API. The reference shows the definition for an event hub source and a Lakehouse destination, not for a custom endpoint | Fabric REST reference, "Eventstream definition", "Items - Create Eventstream" | The script creates it from a definition written by analogy, and uses an eventstream of the same name when it finds one. When Fabric refuses the definition the script prints the reason and four portal steps. **Unproven** |
| 4 | The notebook gets a token for the event hub from the notebook utilities | `notebookutils.credentials.getToken` documents four audiences: storage, Power BI, Key Vault and Kusto. An event hub is not among them | "NotebookUtils credentials utilities for Fabric" on Learn | The notebook asks the Fabric API for the connection of the source, which includes a key, and uses it for one send. The key is not printed or stored. Who may run the notebook may already read that key in the eventstream's details |
| 5 | A command without a turbine is an error | The simulator reads a missing or empty turbine as all twelve (`_targets` in `engine.py`). Right for `simctl resolve` at the edge; dangerous for a command that an agent fills in | Reading the handler before writing the sender | The notebook's code requires a turbine and takes all of them only for the written word `all`. A test hands an empty turbine to it. The simulator is unchanged |
| 6 | A curtailment lasts until it is released | True in the simulator, where `duration` is optional. A command sent from the cloud and forgotten would hold a turbine down until someone noticed | The same reading | The notebook refuses `curtail` without a duration. A test lets a two-minute curtailment end by itself |
| 7 | The Kafka record becomes the MQTT message as it is | Microsoft lists a known issue: with an Event Hubs source whose sender used AMQP, Kafka headers are corrupted when translated to MQTT user properties. What the eventstream writes into the destination's headers is not documented | "Configure Azure Event Hubs and Kafka data flow endpoints" on Learn | The notebook sets no properties of its own. The guide's step 3 shows the message as it arrives on the edge, and its troubleshooting says what to send when it does not. **Unproven** |
| 9 | The notebook's cell passes `percent` only for `curtail` and `duration` only for `curtail` and `stop`, so that a `release` can leave the other values in place | The cell compared the command's name as typed (`command == "curtail"`), while `build_command` brings it to lower case. `Curtail` lost its percent and was refused. `Stop` lost its duration and was sent as a stop without an end, with no message. A `dry_run` that arrives as the text `False` counted as true, and nothing would have been sent. My tests called `build_command` directly and the cell only with its defaults | A review the user passed on at 11:09 on 23 November, an hour after delivery, named the refused `Curtail`; running its example showed the `Stop` and the `dry_run` | `from_parameters` and `as_flag` in `tools/edge_command.py`: the name is normalised before anything is decided by it; `30%`, `10 min`, `10 minutes`, `1 hour` are read; what cannot be read is refused. The cell calls them. 23 new tests, three of them hand a `Stop` written three ways to the simulator and wait for it to end |
| 8 | `infra/99-cleanup.sh --fabric` removes the demo's items | Its list of notebooks ends at 04: the notebooks of Phases 2 and 3, the semantic model, the report, the agents, the ontology and the app are not on it. `--fabric-workspace` removes everything | Reading the script to add the new items | The command eventstream and notebook 12 are added. The items of Phases 2 to 4 are still missing from `--fabric`; to do at the regeneration of Phase 5 |

## Found while building 5b

| # | What I had planned or said | What is true | Source | Changed |
|---|---|---|---|---|
| 10 | Show the approval in the story of Phase 3: wind 7 to 9 m/s, a fault of severity 0.2 on WT-03, the agent proposes to curtail to 30 percent | At 8.5 m/s WT-03 delivers about 1,045 kW. The limit of 30 percent is 1,260 kW. The curtailment costs nothing and relieves nothing: vibration 4.52 to 4.38 mm/s, and that from the wind dropping. An engineer would approve an action without effect, in front of an audience | The simulator, run with the command the action sends before anything else was written: five winds, the fault held, five-minute averages before and after | The guide sets 13 m/s for this phase and says why it differs from Phase 3, with the table of the five winds. The table of the agent has `CurtailCostPerHourUsd`, which is 0 when the limit does not bite. A test holds the five measurements |
| 11 | "The agent notices before the controller raises its own alarm" (the business goal of Phase 3, carried over) | At 12 and 13 m/s the controller's oil temperature warning comes 5 to 6 minutes after the fault starts, in eight of ten runs. The agent looks every five minutes and writes 4 to 9 minutes after the fault, plus its own time. The two arrive together. The warning is a warning: the controller acts at 88 °C, by derating to half | Ten runs with 20-second averages, as the update policy makes them | The goal now says "before the turbine controller has to derate or stop the turbine". The guide tells the story as it is: the controller warns and waits, a person with the cost in front of them need not |
| 12 | Two rules, vibration above 4 mm/s and oil temperature above 72 °C, each proposing the action | In a strong wind both fire for the same fault within minutes: two messages and two proposals for one turbine | The same runs | One rule, on vibration. The oil temperature is in the message, not in a rule |
| 13 | The agent passes the values, and the notebook's own values are the fallback | The notebook's own turbine was `WT-07`. A run that passes no turbine, or passes it under a name written differently, would have curtailed WT-07, whatever turbine the message was about | Reading the parameter cell as a caller that forgets a value | `turbine` is empty in the notebook, and a command without a turbine is refused before anything is sent. A test runs the notebook's cells without a turbine. The same refusal tells, in the rehearsal, when values do not reach the notebook at all |
| 14 | The agent runs the notebook of 5a as it is | Its first code cell was `%pip install`. Fabric switches that magic off when a notebook does not run interactively: "Inline commands for managing Python libraries are disabled in notebook pipeline runs by default", and the error is `%pip magic command is disabled`. Whether a run started by an operations agent counts as such a run is not written anywhere I could read | "Manage Apache Spark libraries in Microsoft Fabric" on Learn; a post in the Fabric community with the error text | The notebook has no magic. The send cell imports the two libraries and, when one is missing, installs it with `python -m pip` as a plain command, then adds the user's package folder to the path if pip had to install there. Tests for both branches and for a pip that fails. An Environment with the two libraries makes the install unnecessary, and the notebook then installs nothing. **Unproven in Fabric**: step 3 |
| 15 | The action has five values: turbine, percent, duration, command, requested_by | A value named `command` lets the agent, or anyone who edits the values before approving, turn "Curtail turbine" into a stop | Asking what each value allows | Four values. Without `command` the notebook's own applies: `curtail`. A test puts six sets of values through the notebook's code and requires a curtailment of the named turbine or a refusal. The word `all` as the turbine is still accepted, as in 5a; the approver sees it |
| 16 | "How an action is added, and how its values are named, is not documented": the guide would describe the page from guesses and ask for a screenshot | Both are documented. The page's source names **Add action**, **Fabric item**, **Action name**, **Action description**. And the definition of an operations agent is published, with a REST API to read and write it for signed-in users: instructions, data sources, actions with a connection to a Fabric item and parameters with a name and a description | "Operations agent actions" in `MicrosoftDocs/fabric-docs`; "Operations agent definition" and "Items - Get Operations Agent Definition" in the Fabric REST reference | `tools/operations_agent.py` and `infra/09-remediation-agent.sh`: save the definition, change the instructions and one action, read it back; `--show`, `--restore`. The way by hand stays in the guide, with the page's own labels. **Unproven**: step 4 |
| 17 | One name for the part that holds the definition | The definition article names it `Configurations.json`. The sample answer of `getDefinition` names it `OperationsAgentV1.json`. The article's own JSON example has a line break inside a string and is not valid JSON | The two pages, read on the same day | The tool finds the part by its content (a JSON object with `configuration`) and writes it back under the name it came with. Tests for both names |
| 18 | "Goals" and "instructions" are two fields | `goals` was removed from the definition in June 2026; goals belong in `instructions`. That is what Phase 3 saw on the page on 21 November: one box | The definition article | The file for 5b is one text, goals first, as in Phase 3 |
| 19 | A curtailed turbine stays in the table the agent watches | Its vibration stays above 4 mm/s while it is curtailed. An agent that watched it would propose the curtailment it has just been given | The measurements: 4.2 to 5.4 mm/s under the limit | The table holds running and derated turbines only. The other side of it: when the hour ends with the fault still there, the turbine is back above 4 mm/s without having crossed it in the table, and the rule may stay silent. Named in step 7 of the guide; an open case with a follow-up is 5c |
| 20 | `WarrantyDaysLeft` is a number of days | After 31 December 2026 it is 0, then negative, and a message would say "minus 12 days of warranty left" | Reading the formula with a date in January | The column's description and the instructions say that 0 or less means the warranty has ended |
| 21 | Phase 5a guide, step 5: "in a weak wind the state stays `RUNNING`" | The state is `CURTAILED` whenever a setpoint below rated power is set, in any wind. In a weak wind the power does not change; the state and the ring do | The simulator at 6 m/s: `CURTAILED` at 425 kW with a setpoint of 1,260 | Corrected in the Phase 5a guide, in step 5 and in its table of failures |
| 22 | The rehearsal takes any turbine the notebook takes | With `all` it would have curtailed twelve turbines to try out a notebook | Reading my own tool before giving it to someone | The rehearsal names one turbine or does not start |
| 23 | Notebook 12 serves both: a person sets its values and runs it, and the agent runs it as its action | Since finding 13 its own turbine is empty, so by hand it needs an edit before every run and the edit has to be undone: the notebook saves by itself, and a turbine left in the cell is the turbine of the next run that passes none. A notebook cannot be safe for a job and handy for a person with the same cell | The user, 35 minutes after the delivery of 5b: "what if I would like to retain the functionality to manually send the commands (for testing, etc)? something like a command center" | A second notebook, `13_command_center`, for sending by hand: no parameter cell, one line per command, the turbines' state as a table, and after each send a wait until the telemetry shows the command, with the seconds. A turbine that already looked like the command's effect before the send is named and not counted as confirmed. Notebook 12 is unchanged, byte for byte. **Unproven in Fabric**: reading the KQL database over REST from a notebook (the token is taken as notebook 09 takes it, the call is the one the app of Phase 4 makes), and the optional panel of widgets |

## Obstacles of the first run

| # | Step | What happened | Cause | Changed | Checked |
|---|---|---|---|---|---|
| A | 4 | 24 November 2026, 19:15. **Run all** went through five cells and stopped in the last: `ImportError: Please install websocket-client library to use sync websocket transport`, raised in `azure/eventhub/_pyamqp/_transport.py` when the client opened its connection | The notebook sends over WebSocket on port 443 (`TransportType.AmqpOverWebsocket`). `azure-eventhub` loads the library for that, `websocket-client`, only when a connection is opened, and does not install it. The Fabric runtime does not have it. I had "checked the library calls against `azure-eventhub` 5.15.1" by building the client with that transport; I never opened a connection, so the missing library never showed. It is the fault of obstacle F of Phase 4 in another place: a check that stops one step before the thing that can fail | The install cell pins both: `%pip install -q azure-eventhub==5.15.1 websocket-client==1.9.2`. The send cell imports `websocket` by name first. A test opens a real connection with the two pinned libraries to an address where nothing listens and requires a network error, not an import error. A troubleshooting row for a notebook of the first two issues. (Since 5b the install is in the send cell and no longer a magic: finding 14) | Reproduced in a clean environment with only `azure-eventhub` 5.15.1: the same error, word for word. With `websocket-client` 1.9.2 beside it, the same send gets as far as the network. 49 tests. **The send in Fabric: reported as working on 24 November, not seen** |

## Seen in the first run

Things that were assumptions on 23 November and are facts since the export of 24 November:

- Fabric Runtime with Python 3.13 and pip 26.1.2. `%pip` restarts the kernel (`PySpark kernel has been restarted to use updated packages`), and the parameter cell placed below it keeps its values.
- `sempy.fabric.FabricRestClient` answers the three calls for the signed-in user: the list of eventstreams, the topology (a source of type `CustomEndpoint` with an `id`), and `…/sources/{id}/connection` with `fullyQualifiedNamespace`, `eventHubName` and `accessKeys.primaryConnectionString`.
- `notebookutils.runtime.context["userName"]` gives the display name of the user (`MOD Administrator`), not the sign-in address.

## Measured in the simulator for 5b

WT-03 with a fault of severity 0.2, held; then `curtail` to 30 percent for 60 minutes, built by the notebook's code. Averages over five minutes, 15 minutes after each change. Seed 7, standing conditions off, as in the other physics tests.

| Wind | Before: vibration, oil, power | Curtailed | Cost per hour |
|---|---|---|---|
| 8.5 m/s | 4.52 mm/s, 73.8 °C, 1,045 kW | 4.38 mm/s, 71.9 °C, 743 kW | 0 USD |
| 10 m/s | 4.79 mm/s, 76.7 °C, 1,769 kW | 4.60 mm/s, 73.3 °C, 1,153 kW | 20 USD |
| 11 m/s | 4.90 mm/s, 78.8 °C, 2,390 kW | 4.69 mm/s, 73.8 °C, 1,245 kW | 44 USD |
| 12 m/s | 4.99 mm/s, 80.6 °C, 3,090 kW | 4.72 mm/s, 74.0 °C, 1,260 kW | 70 USD |
| 13 m/s | 5.05 mm/s, 81.8 °C, 3,630 kW | 4.73 mm/s, 74.1 °C, 1,261 kW | 91 USD |

The timetable, with standing conditions on and readings averaged over 20 seconds as the update policy does:

| Question | Runs | Answer |
|---|---|---|
| Does a healthy turbine cross 4.0 mm/s in the table? | 9 runs of 20 minutes at 11, 12 and 13 m/s | No. Highest average of a healthy turbine 2.15 mm/s, of WT-07 3.21 |
| How warm is a healthy gearbox in a strong wind? | 12 runs at 8.5 to 15 m/s | 54 to 68 °C. None above the early warning of 72 °C |
| When does the vibration of WT-03 cross 4.0 after the fault of the guide (60 minutes, ramping in over five)? | 10 runs at 12 and 13 m/s | After 200 to 220 seconds |
| When does the controller raise `GBX-OIL-TEMP-HIGH`? | The same | After 280 to 360 seconds: in 5 of 5 runs at 13 m/s, in 3 of 5 at 12 |
| When does it clear after a curtailment given 10 minutes after the fault? | The 8 runs in which it was raised | After 229 to 523 seconds |
| Readings under the limit, 1 to 30 minutes after the curtailment | The same 10 runs | Vibration 3.97 to 5.42 mm/s (single readings). Oil up to 80.0 °C in the first minute, 72.5 to 74.5 °C at the tenth, 71.8 to 72.8 °C at the thirtieth |
| How long until a wind set with `simctl wind --mean 13` is there? | 1 run from 6 m/s | About 8 minutes; then a median power of 3,900 to 4,130 kW |
| With a held fault, which ramps in over three minutes | 9 runs at 11 to 13 m/s | Crossing after 120 to 140 seconds, warning after 200 to 280 in 6 of 9, clearing 312 to 469 seconds after the curtailment |

## Checked without Fabric and Azure

| Check | Result on 23 November 2026 |
|---|---|
| `pytest simulator/tests/test_phase5.py` | 49 tests (24 at the first delivery; 23 came with finding 9, 2 with obstacle A): every command the notebook builds is accepted and applied by the simulator's handler of the control topic; fourteen commands that would do more than asked are refused; the cells of the notebook run in order against stand-ins; no key in any output; the script, the data flow template and the simulator name the same topic and the same eventstream |
| Five deliberate mistakes in `tools/edge_command.py`, one at a time | All five made a test fail: an empty turbine taken as all, a curtailment without end, `inject` allowed, a percentage unchecked, a key in an error message. The fifth was caught only after the test was made stricter |
| `bash tools/script-tests/run.sh` | 115 scenarios, 11 of them for `infra/08-create-command-path.sh` |
| `azure-eventhub` 5.15.1 and `websocket-client` 1.9.2 | On 23 November only the client was built, which is why obstacle A was not found. Since 24 November a test opens the connection as well |
| `python3 tools/build-phase5.py --check`, `bash tools/check-scripts.sh`, ShellCheck | Pass |

| Check | Result on 24 November 2026, for 5b |
|---|---|
| `pytest simulator/tests/test_phase5.py` | 56 tests: the 49 of 5a, of which the two about the install cell now test the install on demand and the absence of any magic; and 7 for 5b: the curtailment at five winds, the figures against `data/reference`, the instructions against the columns of the table and the action against the notebook's parameter cell |
| `pytest simulator/tests/test_phase5b.py` | 19 tests against a stand-in that speaks HTTP like the Fabric API as documented: 18 for `tools/operations_agent.py` and one that runs `infra/09-remediation-agent.sh` from end to end with a stand-in for the Azure CLI |
| Eleven deliberate mistakes in `tools/operations_agent.py`, `tools/remediation_spec.py` and the notebook's send cell, one at a time | Ten made a test fail: the agent left running, the old playbook kept, the token sent to another address, a new id for the action at every run, an action made by hand doubled, values typed as numbers, a busy API not waited for, a list read without its continuation, a parameter named differently from the notebook's, the user's package folder not added to the path after an install. The eleventh, not skipping the part `.platform` by its name, changed nothing: that part is passed over by its content as well |
| `pytest simulator/tests/test_phase5_center.py` | 27 tests for the command center. The notebook's cells run top to bottom against stand-ins joined to a simulator: the pretend event hub hands each event to the simulator's control handler, the pretend KQL database answers from the simulator's turbines, and the notebook's waiting moves the simulator's clock. All five commands take effect and are seen; a command lost on the way is reported as not seen after 150 seconds; what the notebook refuses is not sent; the panel, run with the real `ipywidgets` 8.1.9, sends what the cells send. Eleven deliberate mistakes, each caught, one of them only after a test was added (readings from before the command asked for after it) |
| `bash tools/script-tests/run.sh` | 125 scenarios, 10 of them for `infra/09-remediation-agent.sh`: its options, who may run it, a refused token, and that the token is in no output |
| `node tools/kql-syntax-check.js fabric/kql/06-remediation-readiness.kql` | No diagnostics. Not run in an Eventhouse |
| `python3 tools/build-phase5.py --check`, `bash tools/check-scripts.sh`, ShellCheck, the link check | Pass |

## Still open

From 5a, after the report that it works:

- The output of step 1, the messages on the control topic, and the times from **Run all** to `Sent` and from `Sent` to the blue ring. None was sent. Step 3 of the 5b guide measures the job, which is the time that matters now.
- Whether the script made the eventstream from its definition, or it was made by hand.
- `requestedBy` carries a display name when a person runs the notebook, and a text the agent passes when the agent does. For a record of who approved (5c) neither is enough.
- Whether the response of the simulator (`…/_control/response/{requestId}`) should travel to Fabric as well. Today it stays on the edge; 5c needs it, or reads the effect from telemetry.
- `infra/99-cleanup.sh --fabric` and the items of Phases 2 to 4 (finding 8). It does not know the operations agent or `GearboxDecisionLive` either.

From 5b, the seven points of the guide: the update policy on the tenant; values of a job reaching the notebook; pip as a plain command in a job; the update of the agent's definition; the playbook; the values the agent passes and the order of its message; the times.

And three that are no step of the guide:

- Whether the agent speaks again when a curtailment ends with the fault still there (finding 19).
- The command center in Fabric: whether the KQL database answers the notebook's REST call, and whether the panel shows and its buttons run. And its first number: the seconds from a send to the telemetry showing it.
- A control panel in the 3D twin, which is what "command center" may also mean. Not built. Everyone the app is shared with would send commands with the owner's rights, and whether a function of the app may start a notebook job is not known. Asked the user.
- Whether the notebook should run on the Python kernel, which starts in seconds. Left as it is until step 3 has given a number: one change at a time.
- What Fabric does with a playbook when the definition is written with an empty one. The script leaves the agent stopped for that reason.

## Lessons

- A client that is only built has not been checked. The part that fails is the one that runs last: the connection, and whatever it loads on the way. Open it, even to an address where nothing listens.
- The words "checked against the library" need the verb that was checked. I wrote them for a constructor.
- Measure what an action does before writing the message that proposes it. The curtailment I was about to put on an approval card changed nothing at the wind I was about to show it in (finding 10).
- A fallback value that names a real thing is a command waiting for a caller that forgets. `WT-07` as the notebook's own turbine was harmless while a person filled the cell in (finding 13).
- Before describing a page from guesses, look for the form the product publishes of the thing behind the page. The agent's definition and its API were there (finding 16).
- When two pages of the same documentation disagree on a name, depend on neither (finding 17).
- When a thing is changed to suit a new user of it, ask what becomes of the old one. I made notebook 12 safe for the agent and said in one line that it still works by hand; that it had become awkward by hand, the user had to tell me (finding 23).

## Files of Phase 5a

Against the repository at the end of Phase 4 (the state of `changes-phase4-complete.zip` of 23 November): 9 new files and 9 changed ones. `changes-phase5a.zip` holds these 18 files and nothing else, with paths as in the repository. It has been issued three times. The second issue (23 November, finding 9) differs from the first in six files: `tools/edge_command.py`, `tools/build-phase5.py`, `fabric/notebooks/12_send_edge_command.ipynb`, `simulator/tests/test_phase5.py`, `docs/12-deployment-guide-phase5a.md` and this log. The third (24 November, obstacle A) differs from the second in five: the same without `tools/edge_command.py`.

| New | What it is |
|---|---|
| `infra/08-create-command-path.sh` | Creates, shows and removes the eventstream, the endpoint and the data flow |
| `edge/dataflows/fabric-to-windfarm-control.template.json` | The data flow: Kafka source, control topic on the local broker |
| `tools/edge_command.py` | Builds and checks a command; reads the Fabric API's answers. The notebook carries a copy |
| `tools/build-phase5.py` | Builds the notebook from it |
| `fabric/notebooks/12_send_edge_command.ipynb` | Sends one command |
| `simulator/tests/test_phase5.py` | The 49 tests |
| `tools/script-tests/stubs-commands/az` | Stand-in for the scenario tests of the script |
| `docs/12-deployment-guide-phase5a.md`, `docs/phase5-validation-log.md` | The guide and this log |

| Changed | What changed |
|---|---|
| `infra/99-cleanup.sh` | Knows the eventstream `WindFarmCommands` and notebook 12 |
| `tools/script-tests/run.sh` | 11 scenarios for the new script |
| `README.md`, `docs/00-architecture.md`, `docs/03-roadmap.md`, `docs/data-contracts.md`, `fabric/README.md`, `edge/dataflows/README.md` | Phase 5a as built and not yet run |
| `config/demo.env.example` | Three optional names for the command path, as comments |

## Files of Phase 5b

Against the third issue of 5a (24 November, obstacle A): 12 new files and 15 changed ones. `changes-phase5b.zip` holds these 27 files and nothing else, with paths as in the repository. One of them begins with a dot and is easy to miss when copying by hand: `.gitignore`.

The archive has been issued twice on 24 November. The second issue (21:20, the command center, finding 23) differs from the first (20:30) in eleven files. New: `fabric/notebooks/13_command_center.ipynb`, `tools/command_center.py`, `simulator/tests/test_phase5_center.py`. Changed: `tools/build-phase5.py`, `infra/99-cleanup.sh`, `docs/12-deployment-guide-phase5a.md`, `docs/13-deployment-guide-phase5b.md`, `docs/03-roadmap.md`, `fabric/README.md`, `README.md` and this log. Notebook 12 is the same file in both.

| New | What it is |
|---|---|
| `docs/13-deployment-guide-phase5b.md` | The guide |
| `infra/09-remediation-agent.sh` | The agent's instructions and action through the Fabric API; `--show`, `--rehearse`, `--restore` |
| `tools/operations_agent.py` | What that script runs: the calls, the change to the definition, the comparison |
| `tools/remediation_spec.py` | The figures from `data/reference`, the table, the instructions, the action. The three generated files come from it |
| `fabric/kql/06-remediation-readiness.kql` | The table `GearboxDecisionLive` and its update policy. Generated |
| `fabric/operations-agent/phase5b-agent-setup.txt` | The agent's goals and instructions. Generated |
| `fabric/operations-agent/phase5b-action.txt` | The action, for adding it by hand. Generated |
| `simulator/tests/test_phase5b.py` | The 19 tests of the tool and the script |
| `fabric/notebooks/13_command_center.ipynb` | Commands by hand: one line each, the turbines' state, and whether each command showed in the telemetry. Generated |
| `tools/command_center.py` | What that notebook needs besides building a command: the two queries, reading the answer, and telling whether a command is in force |
| `simulator/tests/test_phase5_center.py` | Its 27 tests |
| `tools/script-tests/stubs-agent/az` | Stand-in for the scenario tests of the script |

| Changed | What changed |
|---|---|
| `fabric/notebooks/12_send_edge_command.ipynb` | No `%pip` cell; installs on demand in the send cell; `turbine` empty; the parameter cell is the first code cell. **Import it again** (step 2) |
| `tools/build-phase5.py` | Builds that notebook, the command center and the three generated files of 5b |
| `simulator/tests/test_phase5.py` | 56 tests |
| `tools/script-tests/run.sh` | 10 scenarios for the new script |
| `docs/12-deployment-guide-phase5a.md` | The current notebook in steps 2 and 4; the reported result; finding 21 |
| `docs/phase5-validation-log.md` | This log |
| `README.md`, `docs/00-architecture.md`, `docs/02-demo-runbook.md`, `docs/03-roadmap.md`, `docs/troubleshooting.md`, `fabric/README.md` | Phase 5b as built and not yet run |
| `config/demo.env.example` | Two optional names, as comments |
| `infra/99-cleanup.sh` | Knows notebook 13 |
| `.gitignore` | `fabric/operations-agent/saved/`, where the script keeps the agent's definition before it changes it |
