# Phase 5 validation log

The record of Phase 5, remediation with approval. It is delivered in three steps, each run on the tenant before the next is built: 5a the command path from Fabric to the edge, 5b the approval through the operations agent, 5c the confirmation and the record. This log starts with 5a, written on 23 November 2026. **Nothing of Phase 5 has been deployed yet.**

As in the Phase 4 log, three words are used strictly. **Seen**: the user sent me the output or the screen. **Reported**: the user said so. **Not run**: nobody has run it.

## Progress

| Step of the guide ([12-deployment-guide-phase5a.md](12-deployment-guide-phase5a.md)) | Result | Notes |
|---|---|---|
| 1. Create the command path | Not run | |
| 2. Import the notebook | Not run | |
| 3. Watch the control topic | Not run | |
| 4. Send a command | Not run | |
| 5. See it take effect | Not run | |
| 6. Release | Not run | |

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

## Checked without Fabric and Azure

| Check | Result on 23 November 2026 |
|---|---|
| `pytest simulator/tests/test_phase5.py` | 47 tests (24 at the first delivery; 23 came with finding 9): every command the notebook builds is accepted and applied by the simulator's handler of the control topic; fourteen commands that would do more than asked are refused; the cells of the notebook run in order against stand-ins; no key in any output; the script, the data flow template and the simulator name the same topic and the same eventstream |
| Five deliberate mistakes in `tools/edge_command.py`, one at a time | All five made a test fail: an empty turbine taken as all, a curtailment without end, `inject` allowed, a percentage unchecked, a key in an error message. The fifth was caught only after the test was made stricter |
| `bash tools/script-tests/run.sh` | 115 scenarios, 11 of them for `infra/08-create-command-path.sh` |
| `azure-eventhub` 5.15.1 | The calls of the notebook made against the released library without a network: the producer from a connection string with and without `EntityPath`, the transport over WebSocket, the event with its content type |
| `python3 tools/build-phase5.py --check`, `bash tools/check-scripts.sh`, ShellCheck | Pass |

## Still open

- How long the notebook takes from **Run all** to `Sent` (session start and the install of one library), and from `Sent` to the change in the twin. Neither is measured. The first decides whether the action of 5b is this notebook, the same notebook on the Python kernel, or a user data function.

- The four unproven things of the guide: the eventstream definition, a Kafka source through the CLI, the message on its way from Kafka to MQTT, the notebook's send.
- The shape of the topology answer of the Fabric API (`sources[]` and `destinations[]` with `id` and `type`), assumed from the reference.
- How long a command takes from the notebook to the turbine.
- Whether the response of the simulator (`…/_control/response/{requestId}`) should travel to Fabric as well. Today it stays on the edge; 5c needs it, or reads the effect from telemetry.
- `infra/99-cleanup.sh --fabric` and the items of Phases 2 to 4 (finding 8).

## Files of Phase 5a

Against the repository at the end of Phase 4 (the state of `changes-phase4-complete.zip` of 23 November): 9 new files and 9 changed ones. `changes-phase5a.zip` holds these 18 files and nothing else, with paths as in the repository. It was issued twice on 23 November. The second issue, after finding 9, differs from the first in six files: `tools/edge_command.py`, `tools/build-phase5.py`, `fabric/notebooks/12_send_edge_command.ipynb`, `simulator/tests/test_phase5.py`, `docs/12-deployment-guide-phase5a.md` and this log.

| New | What it is |
|---|---|
| `infra/08-create-command-path.sh` | Creates, shows and removes the eventstream, the endpoint and the data flow |
| `edge/dataflows/fabric-to-windfarm-control.template.json` | The data flow: Kafka source, control topic on the local broker |
| `tools/edge_command.py` | Builds and checks a command; reads the Fabric API's answers. The notebook carries a copy |
| `tools/build-phase5.py` | Builds the notebook from it |
| `fabric/notebooks/12_send_edge_command.ipynb` | Sends one command |
| `simulator/tests/test_phase5.py` | The 47 tests |
| `tools/script-tests/stubs-commands/az` | Stand-in for the scenario tests of the script |
| `docs/12-deployment-guide-phase5a.md`, `docs/phase5-validation-log.md` | The guide and this log |

| Changed | What changed |
|---|---|
| `infra/99-cleanup.sh` | Knows the eventstream `WindFarmCommands` and notebook 12 |
| `tools/script-tests/run.sh` | 11 scenarios for the new script |
| `README.md`, `docs/00-architecture.md`, `docs/03-roadmap.md`, `docs/data-contracts.md`, `fabric/README.md`, `edge/dataflows/README.md` | Phase 5a as built and not yet run |
| `config/demo.env.example` | Three optional names for the command path, as comments |
