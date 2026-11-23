#!/usr/bin/env bash
# Run simctl inside the simulator pod (run on the edge VM).
#   edge/scripts/simctl.sh status
#   edge/scripts/simctl.sh inject WT-07 gearbox_degradation --severity 0.8 --duration 15m
#   edge/scripts/simctl.sh wind --mean 11 --duration 60m
#   edge/scripts/simctl.sh --help
set -euo pipefail
command -v kubectl >/dev/null 2>&1 || {
  echo "ERROR: kubectl not found. This script runs on the edge VM: connect with ./infra/vm.sh ssh" >&2
  exit 1
}
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
exec kubectl exec -n "${SIM_NAMESPACE:-windfarm}" deploy/windfarm-simulator -- simctl "$@"
