"""Phase 5a: the command a notebook writes in Fabric is one the simulator's control topic accepts."""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from conftest import run

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


edge = _load("edge_command", ROOT / "tools" / "edge_command.py")
NOTEBOOK = ROOT / "fabric" / "notebooks" / "12_send_edge_command.ipynb"
NOW = datetime(2026, 11, 23, 16, 0, 0, tzinfo=timezone.utc)


def cells():
    return json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"]


def source(cell) -> str:
    return "".join(cell["source"])


def test_notebook_is_current_and_its_cells_compile():
    assert subprocess.run([sys.executable, str(ROOT / "tools" / "build-phase5.py"), "--check"], capture_output=True).returncode == 0
    code = [c for c in cells() if c["cell_type"] == "code"]
    for cell in code:
        text = "\n".join(line for line in source(cell).split("\n") if not line.startswith("%pip"))
        compile(text, "cell", "exec")
    # %pip restarts the interpreter: it must come before the cell whose values a caller sets.
    kinds = ["pip" if source(c).startswith("%pip") else "parameters" if "parameters" in c["metadata"].get("tags", []) else "other" for c in code]
    assert kinds[:2] == ["pip", "parameters"], kinds
    assert kinds.count("parameters") == 1
    assert re.fullmatch(r"%pip install -q azure-eventhub==\d+\.\d+\.\d+", source(code[0]))


def test_notebook_carries_the_tested_code_and_keeps_no_key():
    whole = "\n".join(source(c) for c in cells())
    module = (ROOT / "tools" / "edge_command.py").read_text(encoding="utf-8")
    for name in ("def build_command", "def find_custom_endpoint", "def send_settings", "def payload"):
        assert name in whole and name in module
    assert module.split("def build_command", 1)[1] in whole
    for forbidden in ("SharedAccessKey=", "Endpoint=sb://", "print(settings)", "print(connection"):
        assert forbidden not in whole
    assert "'connectionString']" not in whole.replace('settings["connectionString"]', "")


@pytest.mark.parametrize("args, state, check", [
    (dict(command="curtail", turbine="wt-01", percent=30, duration="10m"), "CURTAILED", lambda t: t.setpoint_kw == pytest.approx(0.30 * 4200)),
    (dict(command="stop", turbine="WT-01", duration="10m", reason="maintenance"), "MAINTENANCE", lambda t: t.manual_stop == "maintenance"),
])
def test_the_simulator_accepts_and_applies_what_the_notebook_builds(make_sim, args, state, check):
    sim = make_sim(wind=12.0)
    run(sim, 120)
    cmd = json.loads(edge.payload(edge.build_command(now=NOW, requested_by="ops@contoso.example", **args)))
    ack = sim.handle_command(cmd, channel="control")
    assert ack["ok"], ack
    assert ack["requestId"] == cmd["requestId"] and len(cmd["requestId"]) == 12
    run(sim, 180)
    assert sim.turbines["WT-01"].state == state
    assert check(sim.turbines["WT-01"])
    assert sim.turbines["WT-02"].state == "RUNNING"  # one turbine was named, one turbine changed
    undo = "release" if args["command"] == "curtail" else "start"
    assert sim.handle_command(edge.build_command(undo, "WT-01", now=NOW), channel="control")["ok"]
    run(sim, 120)
    assert sim.turbines["WT-01"].state == "RUNNING"


def test_a_curtailment_ends_by_itself(make_sim):
    sim = make_sim(wind=12.0)
    run(sim, 120)
    assert sim.handle_command(edge.build_command("curtail", "WT-01", percent=30, duration="2m", now=NOW), channel="control")["ok"]
    run(sim, 60)
    assert sim.turbines["WT-01"].state == "CURTAILED"
    run(sim, 180)
    assert sim.turbines["WT-01"].state == "RUNNING"


def test_every_command_of_the_notebook_is_one_of_the_control_topic(make_sim):
    from windfarm_sim.engine import CONTROL_COMMANDS
    assert set(edge.COMMANDS) == set(CONTROL_COMMANDS)
    sim = make_sim()
    for name in edge.COMMANDS:
        cmd = edge.build_command(name, "WT-03", percent=50 if name == "curtail" else None, duration="5m" if name == "curtail" else "", now=NOW)
        assert sim.handle_command(cmd, channel="control")["ok"], name
    # The control topic refuses what the notebook must never send; so does the notebook itself.
    assert not sim.handle_command({"command": "inject", "turbine": "WT-03"}, channel="control")["ok"]
    with pytest.raises(edge.CommandError):
        edge.build_command("inject", "WT-03")


@pytest.mark.parametrize("args, says", [
    (dict(command="curtail", turbine="", percent=30, duration="10m"), "not a turbine"),          # the simulator would take "" as all twelve
    (dict(command="curtail", turbine=None, percent=30, duration="10m"), "not a turbine"),
    (dict(command="curtail", turbine="WT-13", percent=30, duration="10m"), "not a turbine"),
    (dict(command="curtail", turbine="WT-07'; drop", percent=30, duration="10m"), "not a turbine"),
    (dict(command="curtail", turbine="WT-07", percent=None, duration="10m"), "needs percent"),
    (dict(command="curtail", turbine="WT-07", percent=130, duration="10m"), "between 0 and 100"),
    (dict(command="curtail", turbine="WT-07", percent=-5, duration="10m"), "between 0 and 100"),
    (dict(command="curtail", turbine="WT-07", percent=30, duration=""), "needs a duration"),
    (dict(command="curtail", turbine="WT-07", percent=30, duration="soon"), "not a duration"),
    (dict(command="curtail", turbine="WT-07", percent=30, duration="0m"), "not a duration"),
    (dict(command="release", turbine="WT-07", percent=30), "takes no percent"),
    (dict(command="start", turbine="WT-07", duration="10m"), "takes no duration"),
    (dict(command="stop", turbine="WT-07", reason="because"), "reason of a stop"),
    (dict(command="wind", turbine="WT-07"), "not a command"),
])
def test_what_would_do_more_than_asked_is_refused_before_it_is_sent(args, says):
    with pytest.raises(edge.CommandError, match=says):
        edge.build_command(**args)


def test_all_turbines_only_when_the_word_is_written(make_sim):
    cmd = edge.build_command("curtail", "ALL", percent=50, duration="5m", now=NOW)
    assert cmd["turbine"] == "all"
    sim = make_sim()
    assert sorted(sim.handle_command(cmd, channel="control")["result"]["curtailed"]) == sorted(sim.turbines)


def test_the_lookup_reads_the_answers_of_the_fabric_api():
    assert edge.find_item([{"id": "1", "displayName": "es-windfarm-edge"}, {"id": "2", "displayName": "WindFarmCommands"}], "WindFarmCommands") == "2"
    assert edge.find_item([], "WindFarmCommands") is None
    topology = {"sources": [{"id": "s", "type": "CustomEndpoint"}], "destinations": [{"id": "k", "type": "Eventhouse"}, {"id": "d", "type": "CustomEndpoint"}]}
    assert edge.find_custom_endpoint(topology, "sources") == "s"
    assert edge.find_custom_endpoint(topology, "destinations") == "d"
    assert edge.find_custom_endpoint({}, "sources") is None
    good = {"fullyQualifiedNamespace": "ns.servicebus.windows.net", "eventHubName": "es_1", "accessKeys": {"primaryConnectionString": "Endpoint=sb://ns/;SharedAccessKey=k"}}
    assert edge.send_settings(good) == {"namespace": "ns.servicebus.windows.net", "eventHub": "es_1", "connectionString": "Endpoint=sb://ns/;SharedAccessKey=k"}
    with pytest.raises(edge.CommandError, match="accessKeys.primaryConnectionString") as failure:
        edge.send_settings({"fullyQualifiedNamespace": "ns", "eventHubName": "es_1", "accessKeys": {"primaryKey": "K3y~value"}})
    assert "K3y~value" not in str(failure.value)  # an error message names what is missing, never what is there


def test_the_script_and_the_data_flow_name_the_topic_the_simulator_listens_on(make_sim):
    sim = make_sim()
    assert sim.control_topic == "contoso/windfarm/northwind-ridge/_control/request"
    script = (ROOT / "infra" / "08-create-command-path.sh").read_text(encoding="utf-8")
    assert 'CONTROL_TOPIC="$TOPIC_ROOT/$SITE_ID/_control/request"' in script
    assert ': "${TOPIC_ROOT:=contoso/windfarm}"' in script and ': "${SITE_ID:=northwind-ridge}"' in script
    template = json.loads((ROOT / "edge" / "dataflows" / "fabric-to-windfarm-control.template.json").read_text(encoding="utf-8"))
    src, dst = template["operations"]
    assert src["operationType"] == "Source" and src["sourceSettings"]["endpointRef"] == "__ENDPOINT_NAME__"
    assert dst["destinationSettings"] == {"endpointRef": "default", "dataDestination": "__CONTROL_TOPIC__"}
    # The eventstream the script makes is the one the notebook looks for.
    builder = (ROOT / "tools" / "build-phase5.py").read_text(encoding="utf-8")
    assert 'EVENTSTREAM = "WindFarmCommands"' in builder and ': "${COMMAND_EVENTSTREAM_NAME:=WindFarmCommands}"' in script


def test_the_cells_run_in_order_against_a_pretend_fabric(monkeypatch, capsys):
    """Every code cell executed top to bottom in one namespace, with stand-ins for the three things only
    Fabric has: the notebook utilities, the Fabric REST client and the network to the event hub."""
    import types

    sent = []
    asked = []

    class Response:
        def __init__(self, body, status=200):
            self.status_code, self._body, self.text = status, body, json.dumps(body)

        def json(self):
            return self._body

    class Client:
        def get(self, path):
            asked.append(path)
            if path.endswith("/eventstreams"):
                return Response({"value": [{"id": "es-id", "displayName": "WindFarmCommands"}]})
            if path.endswith("/topology"):
                return Response({"sources": [{"id": "src-id", "type": "CustomEndpoint"}], "destinations": []})
            if path.endswith("/sources/src-id/connection"):
                return Response({"fullyQualifiedNamespace": "ns.servicebus.windows.net", "eventHubName": "es_1",
                                 "accessKeys": {"primaryConnectionString": "Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=k;SharedAccessKey=S3cr3t=;EntityPath=es_1"}})
            return Response({"message": "not found"}, 404)

    class Batch(list):
        add = list.append

    class Producer:
        @classmethod
        def from_connection_string(cls, text, **kwargs):
            assert "EntityPath=es_1" in text and "eventhub_name" not in kwargs and kwargs["transport_type"] == "websocket"
            return cls()

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def create_batch(self):
            return Batch()

        def send_batch(self, batch):
            sent.extend(batch)

    class EventData:
        def __init__(self, body):
            self.body, self.content_type = body, None

    fabric = types.ModuleType("sempy.fabric")
    fabric.FabricRestClient, fabric.get_workspace_id = Client, lambda: "ws-id"
    sempy = types.ModuleType("sempy")
    sempy.fabric = fabric
    eventhub = types.ModuleType("azure.eventhub")
    eventhub.EventData, eventhub.EventHubProducerClient = EventData, Producer
    eventhub.TransportType = types.SimpleNamespace(AmqpOverWebsocket="websocket")
    azure = types.ModuleType("azure")
    azure.eventhub = eventhub
    for name, module in (("sempy", sempy), ("sempy.fabric", fabric), ("azure", azure), ("azure.eventhub", eventhub)):
        monkeypatch.setitem(sys.modules, name, module)
    utils = types.SimpleNamespace(runtime=types.SimpleNamespace(context={"userName": "sami@contoso.example"}))

    namespace = {"notebookutils": utils}
    for cell in cells():
        if cell["cell_type"] == "code":
            exec("\n".join(line for line in source(cell).split("\n") if not line.startswith("%pip")), namespace)
    out = capsys.readouterr().out
    assert asked == ["v1/workspaces/ws-id/eventstreams", "v1/workspaces/ws-id/eventstreams/es-id/topology",
                     "v1/workspaces/ws-id/eventstreams/es-id/sources/src-id/connection"]
    assert len(sent) == 1 and sent[0].content_type == "application/json"
    command = json.loads(sent[0].body)
    assert command["command"] == "curtail" and command["turbine"] == "WT-07" and command["percent"] == 30 and command["duration"] == "10m"
    assert command["requestedBy"] == "sami@contoso.example"
    assert f"request {command['requestId']}" in out and "Writes to ns.servicebus.windows.net, event hub es_1" in out
    assert "S3cr3t" not in out and "SharedAccessKey" not in out

    # dry_run sends nothing.
    sent.clear()
    dry = {"notebookutils": utils}
    for cell in cells():
        if cell["cell_type"] == "code":
            text = "\n".join(line for line in source(cell).split("\n") if not line.startswith("%pip"))
            exec(text.replace("dry_run = False", "dry_run = True"), dry)
    assert sent == [] and "nothing was sent" in capsys.readouterr().out



@pytest.mark.parametrize("written", ["curtail", "Curtail", "CURTAIL", " curtail ", "cUrTaIl"])
def test_the_command_may_be_written_in_any_case(written):
    """Found in review on 23 November: the cell decided by the name as typed, so `Curtail` lost its percent."""
    cmd = edge.from_parameters(written, "WT-07", percent=30, duration="10m", now=NOW)
    assert (cmd["command"], cmd["percent"], cmd["duration"]) == ("curtail", 30.0, "10m")


@pytest.mark.parametrize("written", ["stop", "Stop", "STOP"])
def test_a_stop_keeps_its_end_however_it_is_written(make_sim, written):
    """The same fault, with a worse result: `Stop` lost its duration silently and became a stop without an end."""
    cmd = edge.from_parameters(written, "WT-01", percent=30, duration="2m", now=NOW)
    assert cmd["command"] == "stop" and cmd["duration"] == "2m" and "percent" not in cmd
    sim = make_sim(wind=12.0)
    run(sim, 120)
    assert sim.handle_command(cmd, channel="control")["ok"]
    run(sim, 60)
    assert sim.turbines["WT-01"].state != "RUNNING"
    run(sim, 180)
    assert sim.turbines["WT-01"].state == "RUNNING"


def test_values_of_the_other_commands_are_left_out_not_refused():
    """Step 6 of the guide: only the command is changed to release; percent and duration stay in the cell."""
    for name in ("release", "Release", "start", "reset"):
        cmd = edge.from_parameters(name, "WT-07", percent=30, duration="10m", now=NOW)
        assert "percent" not in cmd and "duration" not in cmd, name


@pytest.mark.parametrize("percent, duration, want", [
    ("30", "10m", (30.0, "10m")), ("30%", "10 m", (30.0, "10m")), (" 30 % ", "10 min", (30.0, "10m")),
    (30, "10 minutes", (30.0, "10m")), (30, "90 seconds", (30.0, "90s")), (30, "1 hour", (30.0, "1h")), (30, "2 HRS", (30.0, "2h")),
])
def test_a_percentage_and_a_duration_are_read_as_people_write_them(percent, duration, want):
    cmd = edge.from_parameters("curtail", "WT-07", percent=percent, duration=duration, now=NOW)
    assert (cmd["percent"], cmd["duration"]) == want


@pytest.mark.parametrize("percent, duration, says", [
    ("thirty", "10m", "needs percent"), ("30", "600", "not a duration"), ("30", "ten minutes", "not a duration"),
    ("30", "10 fortnights", "not a duration"), ("130%", "10m", "between 0 and 100"), ("30", "", "needs a duration"),
])
def test_what_cannot_be_read_is_still_refused(percent, duration, says):
    with pytest.raises(edge.CommandError, match=says):
        edge.from_parameters("curtail", "WT-07", percent=percent, duration=duration)


def test_dry_run_written_as_text_is_read_as_what_it_says():
    """A parameter that arrives as the text "False" is a true value to Python; the notebook would have sent nothing."""
    assert [edge.as_flag(v) for v in (True, "True", "true", " TRUE ", "1", "yes")] == [True] * 6
    assert [edge.as_flag(v) for v in (False, "False", "false", "0", "no", "")] == [False] * 6
    with pytest.raises(edge.CommandError, match="write True or False"):
        edge.as_flag("maybe")
    code = "\n".join(source(c) for c in cells() if c["cell_type"] == "code")
    assert "dry_run = as_flag(dry_run)" in code and "from_parameters(command, turbine" in code
    assert 'if command == "curtail"' not in code and "command in (" not in code.split("def from_parameters")[0].split("# The command, checked")[-1]
