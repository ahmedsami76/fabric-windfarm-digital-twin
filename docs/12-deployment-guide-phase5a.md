# Deployment guide, Phase 5a: a command from Fabric reaches the edge

Phases 1 to 4 move data one way, from the turbines to Fabric. Phase 5 adds the way back: the operations agent proposes an action, an engineer approves it, and the edge applies it. Phase 5a builds and proves the path that command travels, alone, with a command you send by hand. Phase 5b puts the agent and the approval in front of it.

**Status of this guide.** Written on 23 November 2026. **Nothing of it has run in Fabric or in Azure.** The simulator's side has been there since Phase 1 and is tested. Everything between the notebook and the simulator is built from the documentation and from the source of the Azure CLI extension, and four things in it are unproven: they are listed in [What was and was not tested](#what-was-and-was-not-tested), and each step says what to send me when it does not behave as written. That is the purpose of this step: to find out, on a path with one moving part at a time, before an agent is put on top.

## Contents

- [What you get](#what-you-get)
- [Before you start](#before-you-start)
- [Step 1: Create the command path](#step-1-create-the-command-path)
- [Step 2: Import the notebook](#step-2-import-the-notebook)
- [Step 3: Watch the control topic](#step-3-watch-the-control-topic)
- [Step 4: Send a command](#step-4-send-a-command)
- [Step 5: See it take effect](#step-5-see-it-take-effect)
- [Step 6: Release](#step-6-release)
- [If something fails](#if-something-fails)
- [How it works](#how-it-works)
- [What was and was not tested](#what-was-and-was-not-tested)
- [Remove Phase 5a](#remove-phase-5a)

## What you get

| Item | Where | What it is |
|---|---|---|
| Eventstream **WindFarmCommands** | Fabric workspace | A custom endpoint as source (`CommandIn`), the default stream, a custom endpoint as destination (`CommandOut`). Nothing else: no table, no transformation |
| Notebook **12_send_edge_command** | Fabric workspace | Builds one command, checks it, and writes it to `CommandIn` |
| Data flow endpoint `fabric-commands` | Azure IoT Operations | `CommandOut`, read with the Kafka protocol as the identity of the Azure IoT Operations extension |
| Data flow `fabric-to-windfarm-control` | Azure IoT Operations | From that endpoint to the topic `contoso/windfarm/northwind-ridge/_control/request` on the local MQTT broker |
| `infra/08-create-command-path.sh` | Repository | Creates the eventstream, the endpoint and the data flow; shows them; removes them |

```text
Fabric                                               Edge (Azure IoT Operations)
+-------------------------------------------+        +------------------------------------------+
| Notebook 12 --> CommandIn                  |        | data flow fabric-to-windfarm-control      |
|                 eventstream WindFarmCommands|  Kafka |   Kafka source --> MQTT broker            |
|                 CommandOut ----------------|------->|   topic .../_control/request --> simulator |
+-------------------------------------------+        +------------------------------------------+
```

The simulator applies the command and the telemetry of Phase 1 carries the result back: state `CURTAILED`, the power setpoint, the lower power. In the twin of Phase 4 the ring of the turbine turns blue.

**What a command can do.** The control topic takes five commands: `curtail`, `release`, `stop`, `start`, `reset`. It refuses everything else; injecting a fault or changing the wind is possible only from the edge itself, through `simctl`. The notebook refuses a command without a turbine, a curtailment without an end, and a percentage outside 0 to 100, before anything is sent.

## Before you start

- Phase 1 is deployed and the simulator runs. **The edge VM is running**: `bash infra/vm.sh status`. It stops every day at 08:00 UTC unless you changed that.
- You are signed in on the workstation with `az login`, as the account that owns the Fabric workspace.
- The identity of the Azure IoT Operations extension is a Contributor of the workspace. Step 6.5 of the Phase 1 guide did that, and the telemetry would not arrive without it.
- The repository copy has the files of this phase (the list is in [phase5-validation-log.md](phase5-validation-log.md)).
- Phases 2 to 4 are not needed. With the twin of Phase 4 open you see the result without a query.

Time: about 15 minutes.

## Step 1: Create the command path

**[Workstation]** From the repository folder:

```bash
bash infra/08-create-command-path.sh
```

It does three things and says so as it goes: creates the eventstream `WindFarmCommands` in the workspace, reads from the Fabric API where the edge has to connect, and creates the endpoint and the data flow in Azure IoT Operations. You copy nothing from the portal.

**Check.** The last lines are a small table and two hints:

```text
==> Done
Name                        Mode     State
--------------------------  -------  ---------
fabric-to-windfarm-control  Enabled  Succeeded
```

Above it, the script has printed what the edge reads from: a host ending in `.servicebus.windows.net:9093`, a topic starting with `es_`, and a consumer group.

**If it stops with "Fabric did not create the eventstream from its definition".** This is the first unproven thing: the form of a custom endpoint in an eventstream definition is not in Microsoft's reference, and I wrote it by analogy with the other node types. The script prints what Fabric said, and four portal steps to make the eventstream by hand. Do those, then run the script again: it uses an eventstream it finds. Send me what Fabric said, so that the definition can be corrected.

`bash infra/08-create-command-path.sh --show` prints what exists at any time and changes nothing. The script can be run again: it keeps the eventstream and writes the endpoint and the data flow anew.

## Step 2: Import the notebook

**[Fabric]** In the workspace: **Import**, **Notebook**, **From this computer**, and choose `fabric/notebooks/12_send_edge_command.ipynb` from the repository copy on the computer where the browser runs. It needs no Lakehouse attached.

## Step 3: Watch the control topic

**[Workstation]** In a second terminal, so that you see the command arrive on the edge:

```bash
bash infra/vm.sh ssh bash ./edge/scripts/mqtt-peek.sh --count 2 'contoso/windfarm/northwind-ridge/_control/#'
```

It waits. When a command arrives it prints two messages and ends: the request, and the simulator's answer on `…/_control/response/…` with `"ok": true`.

## Step 4: Send a command

**[Fabric]** Open **12_send_edge_command**. The third cell holds the values:

```python
command = "curtail"
turbine = "WT-07"
percent = 30
duration = "10m"
```

Leave them as they are for the first run and select **Run all**. The first code cell installs one library and takes about a minute.

**Check.** The last code cell prints:

```text
Sent: curtail for WT-07, request 3f9a1c0b7d2e, at 2026-11-23T16:00:00Z UTC.
```

To see what would be sent without sending it, set `dry_run = True`.

## Step 5: See it take effect

Three places, from the nearest to the farthest. Use the first one that shows nothing to find where the command stopped.

| Where | What you see | Within |
|---|---|---|
| The terminal of step 3 | The request with `"command":"curtail","turbine":"WT-07","percent":30.0`, then the response with `"ok": true` and `"curtailed": ["WT-07"]` | Seconds |
| **[Workstation]** `bash infra/vm.sh ssh bash ./edge/scripts/simctl.sh status` | Under `turbines`, WT-07 with `"state": "CURTAILED"` and a power at or below 1260 kW | Half a minute |
| **[Fabric]** KQL queryset on `WindFarmEH`, the query below | `State` is `CURTAILED`, `PowerSetpoint` 1260, `ActivePower` falling towards it | A minute |
| The twin of Phase 4 | The ring of WT-07 turns blue; its panel says Curtailed and 30% of rated | A minute |

```kusto
TurbineTelemetry
| where TurbineId == 'WT-07' and Timestamp > ago(5m)
| project Timestamp, State, PowerSetpoint, ActivePower
| top 5 by Timestamp desc
```

1260 kW is 30 percent of the 4,200 kW the turbine is rated at. In a weak wind the turbine produces less than that anyway: the setpoint still shows, the state stays `RUNNING`, and nothing looks different. For a clear picture have a wind above 9 m/s (`bash infra/vm.sh ssh bash ./edge/scripts/simctl.sh wind --mean 11 --duration 60m`).

**Send me, whatever the outcome:** the output of step 1, the two messages of step 3 (or the fact that none came), and the five rows of the query. With those three I can tell which of the four unproven things held. And two times, read off a clock: from **Run all** to the line `Sent`, and from `Sent` to the ring turning blue. Phase 5b is designed around them.

## Step 6: Release

The curtailment ends by itself after its ten minutes. To end it now, run the notebook again with:

```python
command = "release"
turbine = "WT-07"
```

`percent` and `duration` are ignored for `release`. From the edge, without Fabric: `bash infra/vm.sh ssh bash ./edge/scripts/simctl.sh release all`.

## If something fails

Follow the command along its way. Each row is one hop.

| Symptom | Where it stopped | Do |
|---|---|---|
| Step 1: `No workspace named WindFarmDigitalTwin is visible to this sign-in` | Before anything | `az login` as the account that owns the workspace; or correct `FABRIC_WORKSPACE_NAME` in `config/demo.env` |
| Step 1: `Fabric did not create the eventstream from its definition` | Fabric, creating the eventstream | Make it by hand with the four steps the script prints, run the script again. Send me Fabric's words |
| Step 1: `Fabric did not give the connection of the destination` | Fabric, the eventstream is not running | Open the eventstream in the portal. If it is in edit mode, **Publish**. Then the script again |
| Step 1: `'consumerGroupId' is required in kafka source dataflow endpoint configuration` | The Azure CLI, before it sends the data flow | The endpoint was created without the consumer group. Send me the line of the script's output that starts with `consumer group:` |
| Step 1: an error from `az iot ops dataflow apply` that names the source or the endpoint type | Azure IoT Operations refuses a Kafka source from the CLI | The second unproven thing. Send me the error. The same data flow can be created from a Kubernetes manifest, which Microsoft's page names as supported |
| Step 4: `The Fabric API answered 4…` in the cell that starts with `# Where to write` | The notebook asks Fabric where to write | The message has Fabric's reason. 403: you need at least Contributor on the workspace |
| Step 4: the last cell fails with `ConnectError`, `AuthenticationError` or a timeout | The notebook cannot reach or may not write to the event hub of the eventstream | Send me the error. A workspace with outbound access protection blocks this call |
| Step 4 says `Sent`, step 3 shows nothing | Between the eventstream and the edge | In the portal, open **WindFarmCommands**: the data preview of the stream shows the command if it arrived. If it is there, the data flow is not reading: the two commands below |
| Step 3 shows the request and no response, or a response with `"ok": false` | The simulator refused it | The response carries the reason. A request that is not the JSON the notebook wrote was changed on the way: send me both messages |
| Step 3 shows request and response, the turbine does not change | Nothing is wrong with the path | The wind is too weak for the limit to bite (step 5), or another command released it |

The data flow on the edge, when the eventstream has the command and the topic does not. Open a shell on the VM with `bash infra/vm.sh ssh`, then there:

```bash
kubectl get dataflows.connectivity.iotoperations.azure.com -n azure-iot-operations
```

```bash
kubectl logs -n azure-iot-operations "$(kubectl get pods -n azure-iot-operations -o name | grep -i dataflow | head -n 1)" --tail=80
```

The first lists both data flows, the one of Phase 1 and `fabric-to-windfarm-control`. Send me what the second one prints. An authentication error there means the identity of the extension may not read from the eventstream; a decode or publish error means the message did not survive the translation from Kafka to MQTT, which is the third unproven thing.

## How it works

**Why an eventstream.** A command needs a way from Fabric to a machine behind a firewall that accepts no inbound connection. The edge already reaches out to Fabric for its telemetry; the command travels the same way in the other direction: the edge reads it. An eventstream with a custom endpoint as its destination is, to the edge, a Kafka topic, and Azure IoT Operations can use a Kafka topic as the source of a data flow as long as the local MQTT broker is the destination.

**No key anywhere.** The edge signs in to the eventstream with the managed identity of the Azure IoT Operations extension, as it does for the telemetry. The notebook asks the Fabric API for the connection of `CommandIn` each time it runs and uses it for one send; the key is not printed, not stored and not in the repository. Whoever can run the notebook in this workspace can already read that key in the eventstream's own details pane.

**The script asks instead of you copying.** Phase 1 had you copy a bootstrap server and a topic name from the portal into `config/demo.env`. For the commands the script reads the same values, and the consumer group, from the Fabric API (`…/eventstreams/{id}/destinations/{id}/connection`).

**The command is checked twice.** Once in the notebook, by code that the repository's tests hand to the simulator's own handler; and once by the simulator, which answers every request on `…/_control/response/{requestId}` with `ok` and the reason.

**A turbine is always named.** The simulator reads a command without a turbine as "all twelve". The notebook requires a turbine and takes all of them only when the word `all` is written.

**A curtailment always ends.** The notebook refuses `curtail` without a duration, so a forgotten command cannot hold a turbine down for good.

**The values may be written as people write them.** `Curtail`, `30%` and `10 minutes` mean what they say, and a value the command does not take is left out, not refused: to release, change the command and leave the rest. In the first version of the notebook the cell decided by the command's name as typed. `Curtail` was then refused, and `Stop` lost its duration without a word and became a stop without an end. A review found the first on 23 November, before the notebook had run; the second came out when I ran its example.

## What was and was not tested

**Run, without Fabric and Azure**

| What | How | Result |
|---|---|---|
| The command the notebook builds | 47 tests. Each of the five commands is handed to the simulator's handler of the control topic and applied: a curtailed turbine goes to `CURTAILED` at 1,260 kW and returns by itself, a stopped one to `MAINTENANCE`; its neighbour does not change. Fourteen commands that would do more than asked are refused before sending. The command may be written in any case, and a percentage or a duration as people write them (`30%`, `10 minutes`); a `Stop` keeps its end. Five mistakes planted in the code were each caught | Pass |
| The notebook's cells | Executed top to bottom against stand-ins for the notebook utilities, the Fabric REST client and the event hub: the three calls it makes, the one event it sends, `dry_run`, and that no key reaches the output. The library calls checked against `azure-eventhub` 5.15.1 | Pass. A stand-in is my idea of the other side |
| `infra/08-create-command-path.sh` | 11 scenarios against a stand-in for the Fabric API and the data flow commands: first run, an eventstream made by hand, a refused definition, no destination, a connection that comes late or never, `--show`, `--remove`, no workspace | Pass |
| The options of the `az iot ops` commands | Read in the source of the extension, version 2.11.2: `--group-id` on `create fabric-realtime`; and that `dataflow apply` accepts a Kafka endpoint as source when it has a consumer group and the other side is the local broker | As the script uses them |

**Read in Microsoft's documentation on 23 November 2026, not run**

- A Kafka endpoint can be the source of a data flow when the default MQTT broker is the destination, and needs a consumer group. The operations experience cannot create such a data flow; Kubernetes and Bicep can.
- An eventstream is created from a definition through `POST …/eventstreams`; the connection of a custom endpoint is read through `…/destinations/{id}/connection` and `…/sources/{id}/connection`.
- A principal with Contributor on the workspace can read from a custom endpoint with Microsoft Entra ID authentication.

**Unproven: what the first run decides**

1. **The eventstream definition.** The JSON of a custom endpoint node is not in the reference. If Fabric refuses it, the eventstream is made by hand in four steps and everything after it is unaffected.
2. **A Kafka source through the CLI.** The extension's own check allows it; whether the service takes it from the CLI as it does from Bicep is not shown anywhere I could read.
3. **The message on the way.** That the eventstream hands on the event unchanged, and that the data flow turns the Kafka record into an MQTT message whose payload is the JSON the notebook wrote. Microsoft lists a known issue with Kafka headers written by an AMQP sender when they are translated to MQTT; the notebook sends no properties of its own, and what the eventstream adds is not known.
4. **The notebook's send.** That a Fabric notebook may open a connection to the event hub behind the eventstream on port 443, and that the connection string the API returns is accepted.

Also not run: the topology answer of the Fabric API, whose shape the script and the notebook assume from the reference; and how long a command takes end to end.

## Remove Phase 5a

**[Workstation]**

```bash
bash infra/08-create-command-path.sh --remove
```

It deletes the data flow, the endpoint and the eventstream. Delete the notebook **12_send_edge_command** in the workspace by hand, or leave it: without the eventstream it stops with a message. `bash infra/99-cleanup.sh --fabric` removes both as well.
