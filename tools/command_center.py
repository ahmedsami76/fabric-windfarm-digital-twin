"""What the command center notebook (13_command_center) needs besides building a command: reading the
turbines' state from the KQL database, and telling from the telemetry whether a command took effect.

tools/build-phase5.py copies this file into the notebook, after tools/edge_command.py. It uses the
standard library only and nothing of edge_command, so that the tests can load it by itself.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

TURBINES = [f"WT-{number:02d}" for number in range(1, 13)]
RATED_KW = 4200.0          # data/reference/turbines.csv; a test compares
WAIT_SECONDS = 150         # how long a command is waited for in the telemetry
POLL_SECONDS = 5
STOPPED = ("STOPPED", "MAINTENANCE")


def rows_of(body) -> list[dict]:
    """The rows of the first table of the KQL database's answer (REST, version 1), keyed by column name."""
    tables = (body or {}).get("Tables") if isinstance(body, dict) else None
    table = tables[0] if isinstance(tables, list) and tables else None
    if not isinstance(table, dict) or not isinstance(table.get("Columns"), list) or not isinstance(table.get("Rows"), list):
        raise RuntimeError("The KQL database answered in a form this notebook does not know (no Tables[0]).")
    names = [column.get("ColumnName") for column in table["Columns"]]
    rows = []
    for row in table["Rows"]:
        if not isinstance(row, list):       # a failure inside a result arrives as an object in place of a row
            raise RuntimeError(f"The KQL database reported a failure inside the result: {str(row)[:300]}")
        rows.append(dict(zip(names, row)))
    return rows


def targets_of(turbine: str) -> list[str]:
    """The turbines a command or a question is about. Refuses anything that is not a turbine or the word all."""
    name = str(turbine or "").strip()
    if name.lower() == "all":
        return list(TURBINES)
    if name.upper() not in TURBINES:
        raise ValueError(f"'{turbine}' is not a turbine. Use WT-01 to WT-12, or the word all.")
    return [name.upper()]


def _in_list(turbines: list[str]) -> str:
    return ", ".join(f"'{name}'" for name in turbines)


def status_query(turbine: str = "all") -> str:
    return f"""TurbineTelemetry
| where Timestamp > ago(10m) and TurbineId in ({_in_list(targets_of(turbine))})
| summarize arg_max(Timestamp, State, PowerSetpoint, ActivePower, WindSpeed, GearboxVibration, GearboxOilTemp) by TurbineId
| extend AgeSeconds = toint((now() - Timestamp) / 1s)
| order by TurbineId asc"""


def effect_query(turbine: str, since: str = "") -> str:
    """The newest reading of each turbine the command names: of the last five minutes, or, with `since`
    (the command's issuedAt), only readings taken after the command was written."""
    start = f"datetime({since})" if since else "ago(5m)"
    return f"""TurbineTelemetry
| where Timestamp >= {start} and TurbineId in ({_in_list(targets_of(turbine))})
| summarize arg_max(Timestamp, State, PowerSetpoint, ActivePower) by TurbineId
| extend AgeSeconds = toint((now() - Timestamp) / 1s)"""


def by_turbine(rows: list[dict]) -> dict:
    return {row.get("TurbineId"): row for row in rows}


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None      # NaN is no number


def holds(cmd: dict, row) -> bool:
    """Does this reading show the command in force?"""
    if not row:
        return False
    state, setpoint = row.get("State"), _number(row.get("PowerSetpoint"))
    name = cmd["command"]
    if name == "curtail":
        return setpoint is not None and setpoint <= RATED_KW * float(cmd["percent"]) / 100.0 + 1.0
    if name == "release":
        return state != "CURTAILED"
    if name == "stop":
        return state in STOPPED
    if name == "start":
        return state not in STOPPED
    return state != "FAULT"                            # reset


def what(cmd: dict) -> str:
    name = cmd["command"]
    if name == "curtail":
        return f"limit of {RATED_KW * float(cmd['percent']) / 100.0:.0f} kW in force"
    return {"release": "limit lifted", "stop": "stopped", "start": "running again or free to run", "reset": "trip cleared"}[name]


def _reading(row) -> str:
    if not row:
        return "no reading"
    setpoint, power = _number(row.get("PowerSetpoint")), _number(row.get("ActivePower"))
    parts = [f"state {row.get('State')}"]
    if setpoint is not None:
        parts.append(f"setpoint {setpoint:.0f} kW")
    if power is not None:
        parts.append(f"power {power:.0f} kW")
    if row.get("Timestamp"):
        parts.append(f"reading of {str(row['Timestamp'])[11:19]}Z")
    return ", ".join(parts)


def follow(cmd: dict, before: dict, read, clock=time.monotonic, sleep=time.sleep, say=print,
           limit: float = WAIT_SECONDS, step: float = POLL_SECONDS) -> bool | None:
    """Wait until the telemetry shows the command, and say how long it took.

    `before` holds the newest reading of each turbine from before the send, `read()` returns the newest
    readings taken after it. A turbine whose reading already looked like the command's effect before
    the send proves nothing afterwards and is named as such, not counted as confirmed.
    Returns True when every other turbine showed the effect, False when the time ran out, and None
    when there was nothing the telemetry could show.
    """
    targets = targets_of(cmd["turbine"])
    already = [name for name in targets if holds(cmd, before.get(name))]
    waiting = [name for name in targets if name not in already]
    if already:
        say(f"{', '.join(already)}: already so before the command ({_reading(before.get(already[0]))}). "
            "For that the telemetry cannot show whether this command arrived.")
    if not waiting:
        return None
    say(f"Waiting for the telemetry to show it: {what(cmd)} on {', '.join(waiting)} (up to {limit:.0f} s) ...")
    began, latest = clock(), {}
    while True:
        latest = read() or {}
        for name in list(waiting):
            if holds(cmd, latest.get(name)):
                say(f"{name}: {what(cmd)}, seen {clock() - began:.0f} s after the send ({_reading(latest[name])}).")
                waiting.remove(name)
        if not waiting:
            return True
        if clock() - began >= limit:
            break
        sleep(step)
    for name in waiting:
        say(f"{name}: not seen after {limit:.0f} s ({_reading(latest.get(name) or before.get(name))}).")
    say("Follow the command hop by hop with the table 'If something fails' of docs/12-deployment-guide-phase5a.md: "
        "the eventstream's data preview first, then the control topic on the edge.")
    return False


def status_table(rows: list[dict]) -> str:
    """The state of the turbines as text, one line each."""
    if not rows:
        return ("No telemetry in the last 10 minutes. Is the edge VM running? It stops every day at 08:00 UTC: "
                "bash infra/vm.sh status")
    head = f"{'Turbine':<8} {'State':<17} {'Limit kW':>8} {'Power kW':>8} {'Wind m/s':>8} {'Vib mm/s':>8} {'Oil degC':>8} {'Age s':>6}"
    lines = [head, "-" * len(head)]

    def cell(value, digits, width):
        number = _number(value)
        return f"{'-':>{width}}" if number is None else f"{number:>{width}.{digits}f}"

    for row in rows:
        setpoint = _number(row.get("PowerSetpoint"))
        limit = f"{'-':>8}" if setpoint is None or setpoint >= RATED_KW - 1.0 else f"{setpoint:>8.0f}"
        lines.append(f"{str(row.get('TurbineId')):<8} {str(row.get('State')):<17} {limit} {cell(row.get('ActivePower'), 0, 8)} "
                     f"{cell(row.get('WindSpeed'), 1, 8)} {cell(row.get('GearboxVibration'), 2, 8)} {cell(row.get('GearboxOilTemp'), 1, 8)} "
                     f"{cell(row.get('AgeSeconds'), 0, 6)}")
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    lines.append(f"{len(rows)} turbines, read at {stamp}Z. 'Limit' is the power setpoint when it is below the rated {RATED_KW:.0f} kW.")
    return "\n".join(lines)
