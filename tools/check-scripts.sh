#!/usr/bin/env bash
# Guards for the shell scripts of this repository. Exit code 1 when a rule is broken.
#   tools/check-scripts.sh
#
# Rule 1. Scripts that run on the workstation or in Azure Cloud Shell (infra/) may use
#   the Azure CLI itself and the azure-iot-ops extension, and no other extension. In
#   Cloud Shell, "az connectedk8s" can crash with a 'cffi' version mismatch when it is
#   loaded together with azure-iot-ops (docs/troubleshooting.md).
# Rule 2. A script starts another script of the repository through "bash", never
#   directly, so that a copy without execute permissions still works.
# Rule 3. Every script has the execute permission. A copy that went through Windows
#   or a web upload loses it, and "./infra/vm.sh" then answers "Permission denied".
#   Run this check with "bash tools/check-scripts.sh" after merging an update archive.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORBIDDEN='az[[:space:]]+(connectedk8s|k8s-extension|customlocation|k8s-configuration)([[:space:]]|$)'
FORBIDDEN_ADD='az[[:space:]]+extension[[:space:]]+add.*--name[[:space:]]+(connectedk8s|k8s-extension|customlocation)'
# A line that begins (after indentation, or after "exec") with a path ending in .sh.
DIRECT_CALL='^[[:space:]]*(exec[[:space:]]+)?"?(\$\{?[A-Za-z_]+\}?|\.{1,2})/[^[:space:]"]*\.sh"?([[:space:]]|$)'

status=0
report() {  # report RULE FILE HITS
  printf 'FAIL rule %s: %s\n%s\n' "$1" "${2#"$REPO_ROOT"/}" "$3"
  status=1
}
for script in "$REPO_ROOT"/infra/*.sh "$REPO_ROOT"/edge/scripts/*.sh "$REPO_ROOT"/tools/*.sh; do
  # Comment lines may mention the commands; only executable lines count.
  code="$(grep -n -v -E '^[[:space:]]*#' "$script" || true)"
  ok=yes
  if [[ "$script" == "$REPO_ROOT"/infra/* ]]; then
    if hits="$(grep -E "^[0-9]+:.*($FORBIDDEN|$FORBIDDEN_ADD)" <<< "$code")"; then report 1 "$script" "$hits"; ok=""; fi
  fi
  if hits="$(sed -E 's/^([0-9]+):/\1\t/' <<< "$code" | awk -F'\t' -v re="$DIRECT_CALL" '$2 ~ re {print $1 ": " $2}')" && [[ -n "$hits" ]]; then
    report 2 "$script" "$hits"; ok=""
  fi
  if [[ ! -x "$script" ]]; then
    report 3 "$script" "  not executable. Cure, from the repository root: chmod +x infra/*.sh edge/scripts/*.sh config/load-env.sh tools/*.sh"; ok=""
  fi
  if [[ -n "$ok" ]]; then printf 'ok   %s\n' "${script#"$REPO_ROOT"/}"; fi
done
exit "$status"
