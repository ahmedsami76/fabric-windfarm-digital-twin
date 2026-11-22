"""Phase 4, the Fabric app: what can be checked from Python. The code of the app has its own tests in app/test."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OVERLAY = REPO / "app" / "overlay" / "packages"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_twin_site_data_is_current():
    """The site the twin draws is made from data/reference; the generated module must match it."""
    tool = _load("build_twin_assets", REPO / "tools" / "build-twin-assets.py")
    data = tool.build()
    assert len(data["turbines"]) == 12
    assert len(data["terrain"]["elevationsDm"]) == data["terrain"]["grid"] == 129
    text = tool.OUT.read_text(encoding="utf-8")
    assert '"turbines":[{"id":"WT-01"' in text
    import json
    assert json.dumps(data, separators=(",", ":")).replace("\\", "\\\\").replace("'", "\\'") in text


def test_contract_is_the_same_on_both_sides():
    frontend = (OVERLAY / "frontend" / "src" / "twin" / "data" / "contract.ts").read_text(encoding="utf-8")
    functions = (OVERLAY / "functions" / "src" / "contract.ts").read_text(encoding="utf-8")
    assert frontend == functions


def test_function_types_list_exactly_the_registered_functions():
    """types.ts is written by hand in the form Rayfin generates; it must name the functions that exist."""
    app = (OVERLAY / "functions" / "src" / "function_app.ts").read_text(encoding="utf-8")
    types = (OVERLAY / "functions" / "src" / "types.ts").read_text(encoding="utf-8")
    registered = re.findall(r"udf\.func\(\s*'(\w+)'", app)
    assert registered == ["getLiveState", "getTurbineTrend", "askAgent", "getDiagnostics"]
    assert re.findall(r"^  (\w+): \{$", types, flags=re.M) == registered
    assert "ctx.getToken(" not in app and "getSecret(" not in app  # the deprecated calls


def test_functions_use_names_of_the_earlier_phases():
    config = (OVERLAY / "functions" / "src" / "config.ts").read_text(encoding="utf-8")
    spec = _load("agent_spec", REPO / "tools" / "agent_spec.py")
    assert f"DATA_AGENT_NAME = '{spec.DATA_AGENT}'" in config
    assert "KQL_DATABASE_NAME = 'WindFarmEH'" in config
    assert "WORKSPACE_NAME = 'WindFarmDigitalTwin'" in config
    site = (OVERLAY / "frontend" / "src" / "twin" / "data" / "site.ts").read_text(encoding="utf-8")
    assert f"EARLY_VIBRATION = {spec.EARLY_VIBRATION}" in site
    assert f"ALARM_VIBRATION = {spec.ALARM_VIBRATION}" in site
    assert f"EARLY_OIL_TEMP = {spec.EARLY_OIL_TEMP}" in site


def test_app_queries_use_columns_that_exist():
    """Every column the app asks the KQL database for is a column of the table it asks."""
    tables = (REPO / "fabric" / "kql" / "01-tables.kql").read_text(encoding="utf-8")
    views = (REPO / "fabric" / "kql" / "02-update-policies.kql").read_text(encoding="utf-8")
    live = (OVERLAY / "functions" / "src" / "live.ts").read_text(encoding="utf-8")

    def columns(table: str) -> set[str]:
        definition = re.search(rf"\.create-merge table {table} \(([^)]*)\)", tables).group(1)
        return {part.split(":")[0].strip() for part in definition.split(",")}

    telemetry = re.search(r"TURBINES_QUERY = `(.*?)`;", live, flags=re.S).group(1)
    asked = re.search(r"arg_max\(Timestamp, ([^)]*)\)", telemetry).group(1)
    assert {c.strip() for c in asked.split(",")} <= columns("TurbineTelemetry")
    weather = re.search(r"WEATHER_QUERY = `(.*?)`;", live, flags=re.S).group(1)
    asked = re.search(r"arg_max\(Timestamp, ([^)]*)\)", weather).group(1)
    assert {c.strip() for c in asked.split(",")} <= columns("WeatherObservations")
    assert "ActiveAlarms()" in views
    body = re.search(r"ActiveAlarms\(\) \{(.*?)\n\}", views, flags=re.S).group(1)
    projected = re.findall(r"^\s*\| project (.*)$", body, flags=re.M)[-1]  # the last one shapes the result
    produced = {part.split("=")[0].strip() for part in projected.split(",")}
    for column in re.findall(r"row\.(\w+)", re.search(r"export function toAlarm.*?\n}\n", live, flags=re.S).group(0)):
        assert column in produced, column
    for column in re.findall(r"row\.(\w+)", re.search(r"export function toTurbine.*?\n}\n", live, flags=re.S).group(0)):
        assert column in columns("TurbineTelemetry"), column


def test_create_app_pins_the_version_the_guide_names():
    script = (REPO / "app" / "create-app.sh").read_text(encoding="utf-8")
    version = re.search(r'RAYFIN_VERSION="\$\{RAYFIN_VERSION:-([\d.]+)\}"', script).group(1)
    guide = (REPO / "docs" / "11-deployment-guide-phase4.md").read_text(encoding="utf-8")
    assert f"Rayfin {version}" in guide
    three = re.search(r'THREE_VERSION="([\d.]+)"', script).group(1)
    assert f'"three": "{three}"' in (REPO / "app" / "package.json").read_text(encoding="utf-8")
