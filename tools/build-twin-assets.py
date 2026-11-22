#!/usr/bin/env python3
"""Build the site data the 3D twin of Phase 4 draws: one TypeScript module made from data/reference.

    python3 tools/build-twin-assets.py           write the file
    python3 tools/build-twin-assets.py --check   exit 1 if the file is not current

Source, and the only place to change anything: data/reference/site.json, terrain/heightmap.json and
gis/roads.geojson. The app never reads those files itself; it bundles the generated module, which holds
the data as one line of JSON text. (A module, not a .json file, so that the app needs no compiler
setting for JSON imports.)

Coordinates in the output are metres in the site's local frame: x to the east, y to the north, origin at
the site origin. Elevations are decimetres above sea level as integers, rows south to north, columns west
to east, which is the layout of the heightmap.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REF = REPO / "data" / "reference"
OUT = REPO / "app" / "overlay" / "packages" / "frontend" / "src" / "twin" / "assets" / "site-data.ts"


def sample(heights: list[list[float]], size_m: float, x: float, y: float) -> float:
    """Elevation at a local position, by bilinear interpolation of the grid."""
    n = len(heights)
    step = size_m / (n - 1)
    col = min(max((x + size_m / 2) / step, 0.0), n - 1 - 1e-9)
    row = min(max((y + size_m / 2) / step, 0.0), n - 1 - 1e-9)
    c0, r0 = int(col), int(row)
    fc, fr = col - c0, row - r0
    top = heights[r0][c0] * (1 - fc) + heights[r0][c0 + 1] * fc
    bottom = heights[r0 + 1][c0] * (1 - fc) + heights[r0 + 1][c0 + 1] * fc
    return top * (1 - fr) + bottom * fr


def build() -> dict:
    site = json.loads((REF / "site.json").read_text(encoding="utf-8"))
    terrain = json.loads((REF / "terrain" / "heightmap.json").read_text(encoding="utf-8"))
    roads = json.loads((REF / "gis" / "roads.geojson").read_text(encoding="utf-8"))
    heights = terrain["elevationsM"]
    size_m = float(terrain["sizeM"])
    if len(heights) != terrain["grid"] or any(len(row) != terrain["grid"] for row in heights):
        raise SystemExit("heightmap.json: the grid is not square or not of the stated size")

    turbines = []
    for t in site["turbines"]:
        ground = sample(heights, size_m, t["x"], t["y"])
        if abs(ground - t["elevationM"]) > 1.0:  # the heightmap and the registry must describe one site
            raise SystemExit(f"{t['turbineId']}: registry says {t['elevationM']} m, the heightmap {ground:.1f} m")
        turbines.append({"id": t["turbineId"], "name": t["name"], "x": t["x"], "y": t["y"],
                         "elevationM": t["elevationM"], "string": t["string"]})

    infrastructure = []
    for key in ("metMast", "substation", "omBuilding"):
        a = site[key]
        infrastructure.append({"id": a["id"], "name": a["name"], "type": a["assetType"], "x": a["x"], "y": a["y"],
                               "elevationM": a["elevationM"]})

    # The roads are in longitude and latitude. The registry gives both frames for every turbine, which
    # fixes the two scale factors of the site's flat projection.
    origin = site["origin"]
    east = [t for t in site["turbines"] if abs(t["longitude"] - origin["longitude"]) > 1e-4]
    north = [t for t in site["turbines"] if abs(t["latitude"] - origin["latitude"]) > 1e-4]
    kx = sum(t["x"] / (t["longitude"] - origin["longitude"]) for t in east) / len(east)
    ky = sum(t["y"] / (t["latitude"] - origin["latitude"]) for t in north) / len(north)
    for t in site["turbines"]:  # the fitted projection must give back the registry positions
        dx = (t["longitude"] - origin["longitude"]) * kx - t["x"]
        dy = (t["latitude"] - origin["latitude"]) * ky - t["y"]
        if abs(dx) > 2.0 or abs(dy) > 2.0:
            raise SystemExit(f"{t['turbineId']}: projection is off by {dx:.1f} m east, {dy:.1f} m north")

    road_lines = []
    for feature in roads["features"]:
        p = feature["properties"]
        if feature["geometry"]["type"] != "LineString":
            raise SystemExit(f"road {p['id']}: expected a LineString")
        points = [[round((lon - origin["longitude"]) * kx), round((lat - origin["latitude"]) * ky)]
                  for lon, lat, *_ in feature["geometry"]["coordinates"]]
        road_lines.append({"id": p["id"], "type": p["roadType"], "points": points})

    model = site["turbineModel"]
    return {
        "site": {"id": site["siteId"], "name": site["siteName"], "operator": site["operator"],
                 "capacityMw": site["capacityMw"], "timezone": site["timezone"],
                 "prevailingWindDirectionDeg": site["prevailingWindDirectionDeg"]},
        "turbineModel": {"model": model["model"], "ratedPowerKw": model["ratedPowerKw"],
                         "rotorDiameterM": model["rotorDiameterM"], "hubHeightM": model["hubHeightM"],
                         "cutInWindSpeed": model["cutInWindSpeed"], "ratedWindSpeed": model["ratedWindSpeed"],
                         "cutOutWindSpeed": model["cutOutWindSpeed"], "ratedRotorRpm": model["ratedRotorRpm"]},
        "turbines": turbines,
        "infrastructure": infrastructure,
        "roads": road_lines,
        "terrain": {"grid": terrain["grid"], "sizeM": size_m,
                    "minElevationM": terrain["minElevationM"], "maxElevationM": terrain["maxElevationM"],
                    "elevationsDm": [[round(v * 10) for v in row] for row in heights]},
    }


def main() -> int:
    data = json.dumps(build(), separators=(",", ":"))
    literal = data.replace("\\", "\\\\").replace("'", "\\'")
    text = ("// Generated by tools/build-twin-assets.py from data/reference. Do not edit.\n"
            "// The site as JSON text: turbines, buildings, roads and the terrain grid.\n"
            f"export const SITE_DATA_JSON =\n  '{literal}';\n")
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"not current: {OUT.relative_to(REPO)}. Run python3 tools/build-twin-assets.py")
            return 1
        print("twin assets are up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
