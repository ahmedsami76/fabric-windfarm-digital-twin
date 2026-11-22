#!/usr/bin/env bash
# Scenario tests for infra/vm.sh, infra/01-create-edge-vm.sh, infra/99-cleanup.sh, app/create-app.sh and
# the checks on where a script runs. Nothing here touches Azure or a VM: the commands az, ssh, scp, curl and a
# few others are replaced by the stand-ins in tools/script-tests/stubs, which answer from
# files in a scratch folder and log every call.
#   bash tools/script-tests/run.sh
# These tests show that the scripts take the right decisions. They cannot show that
# Azure answers the way the stand-ins do.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
chmod +x "$HERE"/stubs/*
export STUB_DIR="$SCRATCH/state" PATH="$HERE/stubs:$PATH" ENV_FILE="$SCRATCH/demo.env"
sed -e 's/^SUBSCRIPTION_ID=""/SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000000"/' -e 's/^STORAGE_ACCOUNT_NAME=""/STORAGE_ACCOUNT_NAME="stwindfarm"/' "$REPO/config/demo.env.example" > "$ENV_FILE"
pass=0; fail=0
reset() { rm -rf "$STUB_DIR"; mkdir -p "$STUB_DIR"; echo "VM running" > "$STUB_DIR/power"; echo 20.45.58.189 > "$STUB_DIR/ip"; }
check() {  # check NAME EXPECTED_EXIT PATTERN... ; output in $OUT, exit code in $RC
  local name="$1" want="$2"; shift 2; local ok=yes
  [[ "$RC" == "$want" ]] || ok=""
  for pat in "$@"; do
    if [[ "$pat" == "!"* ]]; then grep -q -- "${pat#!}" <<< "$OUT$(cat "$STUB_DIR/calls.log" 2>/dev/null)" && ok=""
    else grep -q -- "$pat" <<< "$OUT$(cat "$STUB_DIR/calls.log" 2>/dev/null)" || ok=""; fi
  done
  if [[ -n "$ok" ]]; then pass=$((pass+1)); echo "PASS $name"; else fail=$((fail+1)); echo "FAIL $name (exit $RC)"; echo "$OUT" | sed 's/^/     | /'; sed 's/^/     # /' "$STUB_DIR/calls.log"; fi
}
run() { OUT="$("$@" 2>&1)"; RC=$?; }

reset; touch "$STUB_DIR"/port_open
run bash "$REPO"/infra/vm.sh ssh;                       check "ssh, port open: connects as the administrator" 0 "ssh .*azureuser@20.45.58.189" "interactive shell" "!initiate" "!nsg rule update"
run bash "$REPO"/infra/vm.sh ssh bash ./edge/scripts/simctl.sh status
check "ssh COMMAND: runs in the repository folder" 1 "ssh -t .*azureuser@20.45.58.189 cd ~/fabric-windfarm-digital-twin && bash ./edge/scripts/simctl.sh status"

reset; echo "/subscriptions/s/resourceGroups/rg-windfarm-edge/providers/Microsoft.Security/locations/southcentralus/jitNetworkAccessPolicies/default" > "$STUB_DIR"/jitpolicy
printf '52.177.6.131\tMicrosoftDefenderForCloud-JITRule-1-ABC\n' > "$STUB_DIR"/openings
run bash "$REPO"/infra/vm.sh ssh;                       check "ssh, port closed, just-in-time policy: asks for access, then connects" 0 "jitNetworkAccessPolicies/default/initiate" "203.0.113.77" "interactive shell" "!nsg rule update"

reset; echo "198.51.100.9/32" > "$STUB_DIR"/rule; printf '198.51.100.9/32\tallow-ssh-from-admin\n' > "$STUB_DIR"/openings
run bash "$REPO"/infra/vm.sh ssh;                       check "ssh, port closed, own rule elsewhere: moves the rule, then connects" 0 "nsg rule update .*203.0.113.77/32" "interactive shell" "!initiate"

reset
run bash "$REPO"/infra/vm.sh ssh;                       check "ssh, port closed, no rule, no policy: stops with advice" 1 "Cannot open SSH access" "nsg-log" "!interactive shell" "!nsg rule create"

reset
run bash "$REPO"/infra/vm.sh ssh bash ./edge/scripts/simctl.sh status
check "ssh COMMAND, port closed, no rule, no policy: runs the command without SSH" 0 "running the command without SSH" "vm run-command invoke .*sudo -u azureuser -H bash -lc .cd ~/fabric-windfarm-digital-twin && bash ./edge/scripts/simctl.sh status" "!ssh -t" "!nsg rule create"

reset; echo "VM deallocated" > "$STUB_DIR"/power
run bash "$REPO"/infra/vm.sh ssh;                       check "ssh, VM stopped: says to start it" 1 "The VM is not running" "vm.sh start" "!interactive shell"

reset; touch "$STUB_DIR"/port_open; mkdir -p "$STUB_DIR"/home/fabric-windfarm-digital-twin/data/reference "$STUB_DIR"/home/fabric-windfarm-digital-twin/config
echo old > "$STUB_DIR"/home/fabric-windfarm-digital-twin/data/reference/maintenance_history.csv
echo keepme > "$STUB_DIR"/home/fabric-windfarm-digital-twin/notes-of-the-user.txt
run bash "$REPO"/infra/vm.sh push; H="$STUB_DIR/home/fabric-windfarm-digital-twin"
OUT="$OUT
exec:$([[ -x "$H/edge/scripts/simctl.sh" && -x "$H/infra/vm.sh" ]] && echo yes) stale:$([[ -e "$H/data/reference/maintenance_history.csv" ]] && echo present || echo gone) own:$([[ -f "$H/notes-of-the-user.txt" ]] && echo kept) git:$([[ -e "$H/.git" ]] && echo present || echo none) modules:$(find "$H" -name node_modules -o -name __pycache__ | wc -l) nb:$([[ -f "$H/fabric/notebooks/02_generate_history.ipynb" ]] && echo yes)"
check "push: copies, restores execute bits, removes stale files, keeps other files" 0 "exec:yes" "stale:gone" "own:kept" "git:none" "modules:0" "nb:yes"

reset; touch "$STUB_DIR"/port_open
run bash "$REPO"/infra/vm.sh push-env;                  check "push-env: copies the settings file" 0 "scp .*demo.env azureuser@20.45.58.189:fabric-windfarm-digital-twin/config/demo.env"

reset; HOME_BACKUP="$HOME"; export HOME="$STUB_DIR/fakehome"; mkdir -p "$HOME"
run bash "$REPO"/infra/vm.sh reset-key;                 check "reset-key without a key: creates one and installs it" 0 "ssh-keygen" "vm user update .*--username azureuser --ssh-key-value ssh-rsa AAAATESTKEY"
run bash "$REPO"/infra/vm.sh reset-key /nonexistent.pub; check "reset-key with a missing file: stops" 1 "not found"
export HOME="$HOME_BACKUP"

reset
run bash "$REPO"/infra/vm.sh run bash ./edge/scripts/mqtt-peek.sh --count 5
check "run: goes through the VM agent in the repository folder" 0 "sudo -u azureuser -H bash -lc 'cd ~/fabric-windfarm-digital-twin && bash ./edge/scripts/mqtt-peek.sh --count 5'"

reset; echo "/subscriptions/s/resourceGroups/rg-windfarm-edge/providers/Microsoft.Security/locations/southcentralus/jitNetworkAccessPolicies/default" > "$STUB_DIR"/jitpolicy
run bash "$REPO"/infra/vm.sh status;                    check "status with a just-in-time policy: points to vm.sh ssh" 0 "Just-in-time access" "vm.sh ssh opens access" "Administrator:  azureuser"
run bash "$REPO"/infra/vm.sh allow-my-ip;               check "allow-my-ip under a just-in-time policy: refuses" 1 "Not changing the rule" "!nsg rule create"
run bash "$REPO"/infra/vm.sh jit 2;                     check "jit 2: asks for two hours" 0 "initiate" "Granted"
run bash "$REPO"/infra/vm.sh bogus;                     check "unknown action: prints the usage" 2 "infra/vm.sh push" "infra/vm.sh reset-key"

# ---- step 1
reset; rm -f "$STUB_DIR"/power
printf 'Standard_D8s_v5\tNotAvailableForSubscription\nStandard_D8s_v6\tNone\nStandard_D8s_v7\tNone\n' > "$STUB_DIR"/skus
echo Standard_D8s_v6 > "$STUB_DIR"/refused; echo 99999999-aaaa-bbbb-cccc-000000000000 > "$STUB_DIR"/oid
run bash "$REPO"/infra/01-create-edge-vm.sh
check "step 1: skips a restricted size, moves on when Azure refuses one, creates with the next" 0 "Standard_D8s_v5: not offered" "Standard_D8s_v6: refused by Azure" "Created with size Standard_D8s_v7" "CUSTOM_LOCATIONS_OID=\"99999999" "vm.sh push" "user name for SSH" "!vm create .*Standard_D8s_v5" "!vm create .*Standard_D8as"
: > "$STUB_DIR"/calls.log
run bash "$REPO"/infra/01-create-edge-vm.sh
check "step 1 again: keeps the existing VM" 0 "exists already (Standard_D8s_v7)" "!vm create"

reset; rm -f "$STUB_DIR"/power; printf 'Standard_D8s_v5\tNotAvailableForSubscription\n' > "$STUB_DIR"/skus
run bash "$REPO"/infra/01-create-edge-vm.sh
check "step 1, nothing offered: stops and says what to do" 1 "None of these sizes is offered" "az vm list-skus" "!vm create"

reset; rm -f "$STUB_DIR"/power; printf 'Standard_D8s_v5\tNone\n' > "$STUB_DIR"/skus
run bash "$REPO"/infra/01-create-edge-vm.sh
check "step 1, object ID not readable: warns with the CLI message" 0 "Could not read the Custom Locations object ID" "Insufficient privileges"
sed -i.bak 's/^CUSTOM_LOCATIONS_OID=""/CUSTOM_LOCATIONS_OID="77777777-aaaa-bbbb-cccc-000000000000"/' "$ENV_FILE"; : > "$STUB_DIR"/calls.log
run bash "$REPO"/infra/01-create-edge-vm.sh
check "step 1, object ID already set: does not look it up" 0 "77777777-aaaa-bbbb-cccc-000000000000   (from config/demo.env)" "!ad sp show"

# ---- where a script runs
reset; echo vm-windfarm-edge > "$STUB_DIR"/hostname
run bash "$REPO"/infra/vm.sh status;                    check "workstation script on the edge VM: stops" 1 "not on the edge VM"
run bash "$REPO"/infra/04-deploy-iot-operations.sh;     check "step 4 on the edge VM: stops" 1 "not on the edge VM" "!iot ops"
reset
run bash "$REPO"/edge/scripts/05-deploy-simulator.sh;   check "edge script on the workstation: stops and says how to connect" 1 "runs on the edge VM" "vm.sh ssh"
run bash "$REPO"/edge/scripts/07-sync-reference-data.sh; check "step 7 on the workstation: stops" 1 "runs on the edge VM"
# The mistake of the second deployment: the name of the custom location in the object ID setting.
reset
run env CUSTOM_LOCATIONS_OID_OVERRIDE=cl-windfarm-edge bash -c 'sed -e "s/^CUSTOM_LOCATIONS_OID=.*/CUSTOM_LOCATIONS_OID=\"cl-windfarm-edge\"/" "$ENV_FILE" > "$ENV_FILE.bad"; ENV_FILE="$ENV_FILE.bad" bash "$0"/infra/01-create-edge-vm.sh' "$REPO"
check "step 1, object ID setting holds a name: stops before creating anything" 1 "must be an object ID" "CUSTOM_LOCATION_NAME" "!vm create" "!group create"
run env bash -c 'sed -e "s/^CUSTOM_LOCATIONS_OID=.*/CUSTOM_LOCATIONS_OID=\"bc313c14-388c-4e7d-a58e-70017303ee3b\"/" "$ENV_FILE" > "$ENV_FILE.bad"; ENV_FILE="$ENV_FILE.bad" bash "$0"/infra/01-create-edge-vm.sh' "$REPO"
check "step 1, object ID setting holds the application ID: stops" 1 "application ID of the Custom Locations service" "!vm create"

# ---- rebuilding the settings file (infra/rebuild-env.sh)
deployed() {
  reset; touch "$STUB_DIR/rg"; echo Standard_D8s_v7 > "$STUB_DIR/vmsize"; echo "Enabled 0800" > "$STUB_DIR/schedule"
  echo 040ca937-7748-471b-a3ea-31d1ebd5da8a > "$STUB_DIR/oid"
  printf '%s\n' esehabc123.servicebus.windows.net:9093 es_11111111-2222-3333-4444-555555555555 > "$STUB_DIR/eventstream"
  printf '%s\t%s\n' Microsoft.Compute/virtualMachines vm-windfarm-edge Microsoft.Kubernetes/connectedClusters arc-windfarm-edge \
    Microsoft.IoTOperations/instances aio-windfarm Microsoft.ExtendedLocation/customLocations cl-windfarm-edge \
    Microsoft.Storage/storageAccounts stwindfarm123 Microsoft.DeviceRegistry/schemaRegistries sr-windfarm \
    Microsoft.DeviceRegistry/namespaces adr-windfarm Microsoft.Network/publicIPAddresses vm-windfarm-edgePublicIP > "$STUB_DIR/resources"
}
NEW_ENV="$SCRATCH/rebuilt.env"
deployed; rm -f "$NEW_ENV"
run env ENV_FILE="$NEW_ENV" bash "$REPO"/infra/rebuild-env.sh
OUT="$OUT
file:$(grep -E '^(SUBSCRIPTION_ID|LOCATION|VM_SIZE|VM_AUTO_SHUTDOWN_UTC|STORAGE_ACCOUNT_NAME|SCHEMA_REGISTRY_NAMESPACE|CUSTOM_LOCATIONS_OID|CUSTOM_LOCATION_NAME|EVENTSTREAM_TOPIC|EVENTSTREAM_BOOTSTRAP_SERVER|SIM_IMAGE)=' "$NEW_ENV" | cut -d'#' -f1 | tr -d ' ' | tr '\n' ';')
lines:$(( $(wc -l < "$NEW_ENV") - $(wc -l < "$REPO/config/demo.env.example") ))"
check "rebuild-env: fills the settings file from what is deployed" 0 'SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000000";' 'LOCATION="southcentralus";' 'VM_SIZE="Standard_D8s_v7";' 'VM_AUTO_SHUTDOWN_UTC="0800";' 'STORAGE_ACCOUNT_NAME="stwindfarm123";' 'SCHEMA_REGISTRY_NAMESPACE="sr-windfarm-ns";' 'CUSTOM_LOCATION_NAME="cl-windfarm-edge";' 'CUSTOM_LOCATIONS_OID="040ca937-7748-471b-a3ea-31d1ebd5da8a";' 'EVENTSTREAM_BOOTSTRAP_SERVER="esehabc123.servicebus.windows.net:9093";' 'EVENTSTREAM_TOPIC="es_11111111-2222-3333-4444-555555555555";' 'SIM_IMAGE="windfarm-simulator:1.1.0"' "lines:0" "!WARNING" "!nsg rule" "!vm start"
run env ENV_FILE="$NEW_ENV" bash "$REPO"/infra/01-create-edge-vm.sh --help >/dev/null 2>&1; run env ENV_FILE="$NEW_ENV" bash -c 'source "$0"/config/load-env.sh && require_object_id CUSTOM_LOCATIONS_OID && echo LOADS-OK "$CLUSTER_NAME"' "$REPO"
check "rebuild-env: the file it writes loads" 0 "LOADS-OK arc-windfarm-edge"

run env ENV_FILE="$NEW_ENV" bash "$REPO"/infra/rebuild-env.sh
check "rebuild-env, settings file exists: stops without --force" 1 "Add --force" "!Writing"
deployed; rm -f "$STUB_DIR/oid" "$STUB_DIR/eventstream" "$STUB_DIR/schedule"
run env ENV_FILE="$NEW_ENV" bash "$REPO"/infra/rebuild-env.sh --force
OUT="$OUT
file:$(grep -E '^(CUSTOM_LOCATIONS_OID|EVENTSTREAM_TOPIC|VM_AUTO_SHUTDOWN_UTC)=' "$NEW_ENV" | cut -d'#' -f1 | tr -d ' ' | tr '\n' ';') bak:$([[ -f "$NEW_ENV.bak" ]] && echo kept)"
check "rebuild-env --force, no directory access, no data flow, no shutdown: says what to set by hand" 0 'CUSTOM_LOCATIONS_OID="";' 'EVENTSTREAM_TOPIC="";' 'VM_AUTO_SHUTDOWN_UTC="";' "bak:kept" "Not found in Azure" "CUSTOM_LOCATIONS_OID: this sign-in may not read" "EVENTSTREAM_TOPIC: the data flow"
reset
run env ENV_FILE="$SCRATCH/none.env" bash "$REPO"/infra/rebuild-env.sh rg-other
check "rebuild-env, resource group missing: stops" 1 "Resource group rg-other does not exist" "az account set"

# ---- clean-up (infra/99-cleanup.sh)
export CLEANUP_STATE_FILE="$SCRATCH/cleanup-note"
CLEAN="$REPO/infra/99-cleanup.sh"
azure_state() {       # a complete deployment in Azure
  reset; rm -f "$CLEANUP_STATE_FILE"; touch "$STUB_DIR/rg"
  printf '%s\t%s\n' Microsoft.Compute/virtualMachines vm-windfarm-edge Microsoft.Kubernetes/connectedClusters arc-windfarm-edge \
    Microsoft.IoTOperations/instances aio-windfarm Microsoft.Storage/storageAccounts stwindfarm \
    Microsoft.Network/networkSecurityGroups vm-windfarm-edgeNSG Microsoft.ExtendedLocation/customLocations cl-windfarm-edge > "$STUB_DIR/resources"
  echo aio-windfarm > "$STUB_DIR/instance"; echo Connected > "$STUB_DIR/cluster"
  printf 'azure-iot-operations-ab1cd\naaaaaaaa-0000-0000-0000-00000000e0e0\n' > "$STUB_DIR/extension"
  printf '%s\t%s\t%s\n' /subscriptions/s/providers/Microsoft.Authorization/roleAssignments/sub-reader Reader /subscriptions/s \
    /subscriptions/s/resourceGroups/rg-windfarm-edge/providers/Microsoft.Authorization/roleAssignments/rg-onboard "Kubernetes Cluster - Azure Arc Onboarding" /subscriptions/s/resourceGroups/rg-windfarm-edge > "$STUB_DIR/roles"
}
fabric_state() {      # the demo's workspace, on the second page of the workspace list, with items that are not the demo's
  mkdir -p "$STUB_DIR/fabric"
  echo '{"value":[{"id":"ws-other","displayName":"Sales"}],"continuationUri":"https://api.fabric.microsoft.com/v1/workspaces?continuationToken=abc"}' > "$STUB_DIR/fabric/workspaces.json"
  echo '{"value":[{"id":"ws-demo","displayName":"WindFarmDigitalTwin"}]}' > "$STUB_DIR/fabric/workspaces2.json"
  cat > "$STUB_DIR/fabric/items.json" <<'JSON'
{"value":[
 {"id":"it-eh","type":"Eventhouse","displayName":"WindFarmEH"},
 {"id":"it-kdb","type":"KQLDatabase","displayName":"WindFarmEH"},
 {"id":"it-qs","type":"KQLQueryset","displayName":"WindFarmEH_queryset"},
 {"id":"it-lh","type":"Lakehouse","displayName":"WindFarmLH"},
 {"id":"it-sql","type":"SQLEndpoint","displayName":"WindFarmLH"},
 {"id":"it-es","type":"Eventstream","displayName":"es-windfarm-edge"},
 {"id":"it-nb1","type":"Notebook","displayName":"01_load_reference_data"},
 {"id":"it-nb2","type":"Notebook","displayName":"02_generate_history"},
 {"id":"it-mine","type":"Notebook","displayName":"My own analysis"},
 {"id":"it-rep","type":"Report","displayName":"Sales report"}]}
JSON
  cat > "$STUB_DIR/fabric/access.json" <<'JSON'
{"value":[
 {"id":"u-1","principal":{"id":"u-1","displayName":"Sami","type":"User"},"role":"Admin"},
 {"id":"11111111-2222-3333-4444-555555555555","principal":{"id":"11111111-2222-3333-4444-555555555555","displayName":"vm-windfarm-edge","type":"ServicePrincipal"},"role":"Contributor"},
 {"id":"aaaaaaaa-0000-0000-0000-00000000e0e0","principal":{"id":"aaaaaaaa-0000-0000-0000-00000000e0e0","displayName":"azure-iot-operations-ab1cd","type":"ServicePrincipal"},"role":"Contributor"},
 {"id":"sp-other","principal":{"id":"sp-other","displayName":"reporting-app","type":"ServicePrincipal"},"role":"Member"}]}
JSON
}
order() {             # order A B: true when the first call matching A comes before the first call matching B
  local a b
  a="$(grep -n -m1 -- "$1" "$STUB_DIR/calls.log" | cut -d: -f1)"; b="$(grep -n -m1 -- "$2" "$STUB_DIR/calls.log" | cut -d: -f1)"
  [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]]
}

azure_state; fabric_state
run bash "$CLEAN"
check "clean-up without options: shows what exists and changes nothing" 0 "Nothing was changed" "VM running" "Connected" "aio-windfarm" "Reader on /subscriptions/s" "Eventstream es-windfarm-edge" "Notebook My own analysis" "!group delete" "!iot ops delete" "!--method delete" "!role assignment delete" "!vm start"

azure_state
run bash "$CLEAN" --azure --yes
order "iot ops delete" "group delete" && order "role assignment delete" "group delete" && OUT="$OUT ORDER-OK"
OUT="$OUT note:$(tr '\n' ' ' < "$CLEANUP_STATE_FILE" 2>/dev/null)"
check "--azure: uninstalls, removes both role assignments, deletes the group, in that order" 0 "iot ops delete --name aio-windfarm --resource-group rg-windfarm-edge --include-deps --yes$" "role assignment delete --ids /subscriptions/s/providers/Microsoft.Authorization/roleAssignments/sub-reader" "role assignment delete --ids .*rg-onboard" "group delete --name rg-windfarm-edge --yes$" "Nothing of this deployment is left in Azure" "ORDER-OK" "note:VM_PRINCIPAL_ID=11111111-2222-3333-4444-555555555555 AIO_EXTENSION_NAME=azure-iot-operations-ab1cd AIO_EXTENSION_PRINCIPAL_ID=aaaaaaaa-0000-0000-0000-00000000e0e0" "!vm start" "!--force" "!extension add"

azure_state; echo "VM deallocated" > "$STUB_DIR/power"; echo Offline > "$STUB_DIR/cluster"; touch "$STUB_DIR/connect_on_start"
run bash "$CLEAN" --azure --yes
order "vm start" "iot ops delete" && OUT="$OUT ORDER-OK"
check "--azure with the VM stopped: starts it, waits for the cluster, then uninstalls normally" 0 "vm start" "iot ops delete --name aio-windfarm .*--include-deps --yes$" "group delete" "ORDER-OK" "!--force"

attempts() { OUT="$OUT attempts:$(grep -c "iot ops delete" "$STUB_DIR/calls.log");"; }

# The error of the first real run: Azure shows the cluster as connected, but cannot reach it yet.
azure_state; echo 2 > "$STUB_DIR/unreachable"
run bash "$CLEAN" --azure --yes; attempts
order "iot ops delete" "group delete" && OUT="$OUT ORDER-OK"
check "--azure, Azure cannot reach the cluster yet: tries again until the uninstall gets through" 0 "ClusterNetworkUnavailable" "Trying again in 150 seconds" "attempt 3 of 4" "attempts:3;" "ORDER-OK" "Nothing of this deployment is left in Azure" "!WARNING" "!--force"

azure_state; echo 99 > "$STUB_DIR/unreachable"
run bash "$CLEAN" --azure --yes; attempts
check "--azure, Azure never reaches the cluster: gives up after four attempts and deletes the group" 0 "attempts:4;" "was not uninstalled, because Azure could not reach the cluster" "group delete --name rg-windfarm-edge --yes" "Nothing of this deployment is left in Azure"

azure_state; echo "VM deallocated" > "$STUB_DIR/power"; echo Offline > "$STUB_DIR/cluster"
run bash "$CLEAN" --azure --yes; attempts
check "--azure, cluster stays offline after the VM start: tries with --force, gives up, deletes the group" 0 "vm start" "Waiting up to 10 minutes" "iot ops delete --name aio-windfarm .*--include-deps --yes --force" "attempts:4;" "was not uninstalled" "group delete"

# Azure's status lags behind: shown as offline, but reachable.
azure_state; echo Offline > "$STUB_DIR/cluster"; touch "$STUB_DIR/reachable_anyway"
run bash "$CLEAN" --azure --yes; attempts
check "--azure, cluster shown as offline but reachable: the attempt with --force gets through" 0 "iot ops delete --name aio-windfarm .*--yes --force" "attempts:1;" "group delete" "!WARNING" "!vm start"

# A second run after the VM is gone and the cluster's Azure resources were left.
azure_state; rm -f "$STUB_DIR/power"; echo Offline > "$STUB_DIR/cluster"
run bash "$CLEAN" --azure --yes; attempts
check "--azure, VM gone and cluster resources left: one attempt, no waiting, then the group" 0 "attempts:1;" "was not uninstalled" "group delete --name rg-windfarm-edge --yes" "!vm start" "!Trying again" "!Waiting up to"

# The VM was stopped a moment ago: Azure still shows the cluster as connected.
azure_state; echo "VM deallocated" > "$STUB_DIR/power"
run bash "$CLEAN" --azure --yes
order "vm start" "iot ops delete" && OUT="$OUT ORDER-OK"
check "--azure, VM stopped but cluster still shown as connected: starts the VM first all the same" 0 "vm start" "two minutes" "ORDER-OK" "group delete" "!--force"

azure_state; touch "$STUB_DIR/no_cli_extension"
run bash "$CLEAN" --azure --yes
order "extension add --yes --name azure-iot-ops" "iot ops delete" && OUT="$OUT ORDER-OK"
check "--azure without the CLI extension: installs it before the uninstall" 0 "ORDER-OK" "group delete"

azure_state; : > "$STUB_DIR/instance"
run bash "$CLEAN" --azure --yes
check "--azure, instance already gone: cleans up the cluster by name" 0 "iot ops delete --cluster arc-windfarm-edge --resource-group rg-windfarm-edge --include-deps --yes$" "group delete"

azure_state; touch "$STUB_DIR/uninstall_fails"
run bash "$CLEAN" --azure --yes; attempts
check "--azure, uninstall fails for another reason: no second attempt, warns, still deletes the group" 0 "AuthorizationFailed" "The uninstall of Azure IoT Operations failed" "attempts:1;" "group delete --name rg-windfarm-edge --yes" "!Trying again"

azure_state; touch "$STUB_DIR/group_delete_fails"
run bash "$CLEAN" --azure --yes
check "--azure, group deletion fails: says what is left and ends with exit code 3" 3 "Deleting the resource group failed" "Left for you to do" "vm-windfarm-edge  (Microsoft.Compute/virtualMachines)"

azure_state
run bash "$CLEAN" --azure --yes --no-wait
check "--azure --no-wait: starts the deletion and returns" 0 "group delete --name rg-windfarm-edge --yes --no-wait" "Deletion started"

azure_state; rm -f "$STUB_DIR/rg"
run bash "$CLEAN" --azure --yes
check "--azure, no resource group: nothing to do" 0 "does not exist" "!group delete" "!iot ops delete"

azure_state; printf '%s\t%s\n' Microsoft.Web/sites someones-app Microsoft.Sql/servers someones-db > "$STUB_DIR/resources"
run bash "$CLEAN" --azure --yes
check "--azure, a group that is not the demo's: refuses" 1 "does not look like this demo" "!group delete" "!iot ops delete"

azure_state
run bash "$CLEAN" --azure < /dev/null
check "--azure without --yes and without a terminal: refuses" 1 "Add --yes" "!group delete" "!iot ops delete" "!role assignment delete"

azure_state; fabric_state
run bash "$CLEAN" --fabric --yes
order "items/it-es?hardDelete=true" "items/it-nb1" && order "items/it-nb2" "items/it-qs" && order "items/it-qs" "items/it-lh" && order "items/it-lh" "items/it-eh" && OUT="$OUT ORDER-OK"
OUT="$OUT deleted:$(sort "$STUB_DIR/fabric/deleted" | tr '\n' ' ')END"
check "--fabric: deletes the demo's six items for good, in order, and the two identities' access; leaves the rest" 0 "ORDER-OK" "deleted:11111111-2222-3333-4444-555555555555 aaaaaaaa-0000-0000-0000-00000000e0e0 it-eh it-es it-lh it-nb1 it-nb2 it-qs END" "workspaces?continuationToken=abc" "Left alone" "Notebook My own analysis" "Report Sales report" "roleAssignments/11111111" "!group delete" "!it-mine?" "!items/it-kdb" "!items/it-sql" "!roleAssignments/u-1" "!roleAssignments/sp-other"

azure_state; fabric_state; echo it-lh > "$STUB_DIR/fabric/no_hard"
run bash "$CLEAN" --fabric --yes
check "--fabric, permanent delete refused for the Lakehouse: normal delete, and says where the item is now" 0 "items/it-lh?hardDelete=true" "items/it-lh --output none" "Lakehouse WindFarmLH: deleted, but not permanently" "Recycle bin" "Eventhouse WindFarmEH: deleted$"

azure_state; fabric_state; echo it-eh > "$STUB_DIR/fabric/no_hard"
run bash "$CLEAN" --fabric --yes
check "--fabric, permanent delete refused for the Eventhouse: normal delete, which is final for that type" 0 "items/it-eh --output none" "Eventhouse WindFarmEH: deleted$" "!not permanently" "!Recycle bin"

azure_state; fabric_state; echo it-eh > "$STUB_DIR/fabric/undeletable"
run bash "$CLEAN" --fabric --yes
check "--fabric, an item that cannot be deleted: tries the three routes, reports it, exit code 3" 3 "items/it-eh?hardDelete=true" "eventhouses/it-eh" "Eventhouse WindFarmEH could not be deleted" "Left for you to do"

azure_state; fabric_state; touch "$STUB_DIR/fabric_no_token"
run bash "$CLEAN" --fabric --yes
check "--fabric, no token for the Fabric API: prints the portal steps, deletes nothing" 3 "could not be used from this session" "AADSTS65001" "Manage access" "Left for you to do" "!--method delete"

azure_state; fabric_state; echo '{"value":[{"id":"ws-other","displayName":"Sales"}]}' > "$STUB_DIR/fabric/workspaces.json"
run bash "$CLEAN" --fabric --yes
check "--fabric, workspace not found: nothing to do" 0 "No workspace named WindFarmDigitalTwin" "!--method delete"

azure_state; fabric_state
run bash "$CLEAN" --fabric-workspace --yes
check "--fabric-workspace: deletes the workspace and nothing else" 0 "--method delete --url https://api.fabric.microsoft.com/v1/workspaces/ws-demo --output none" "Workspace deleted" "!items/it-" "!roleAssignments/" "!group delete"

azure_state; fabric_state
run bash "$CLEAN" --all --yes
order "items/it-eh" "group delete" && order "roleAssignments/aaaaaaaa" "iot ops delete" && OUT="$OUT ORDER-OK"
check "--all: Fabric first, while Azure still knows the identities, then Azure" 0 "ORDER-OK" "roleAssignments/11111111" "iot ops delete" "group delete" "keep CUSTOM_LOCATIONS_OID"

# Azure was cleaned up earlier: the identities are gone there, and Fabric no longer shows their names.
azure_state; fabric_state; rm -f "$STUB_DIR/rg" "$STUB_DIR/extension"; touch "$STUB_DIR/no_vm"
printf 'VM_PRINCIPAL_ID=11111111-2222-3333-4444-555555555555\nAIO_EXTENSION_NAME=azure-iot-operations-ab1cd\nAIO_EXTENSION_PRINCIPAL_ID=aaaaaaaa-0000-0000-0000-00000000e0e0\n' > "$CLEANUP_STATE_FILE"
sed -i.bak -e 's/"displayName":"vm-windfarm-edge"/"displayName":""/' -e 's/"displayName":"azure-iot-operations-ab1cd"/"displayName":""/' "$STUB_DIR/fabric/access.json"
run bash "$CLEAN" --fabric --yes
check "--fabric after --azure: finds the identities' access through the saved note" 0 "roleAssignments/11111111-2222-3333-4444-555555555555" "roleAssignments/aaaaaaaa-0000-0000-0000-00000000e0e0" "(identity deleted)" "!roleAssignments/sp-other"

azure_state; fabric_state
run env ENV_FILE=/nonexistent/demo.env SUBSCRIPTION_ID=00000000-0000-0000-0000-000000000000 RESOURCE_GROUP=rg-windfarm-edge bash "$CLEAN"
check "clean-up without demo.env, settings on the command line: works with the default names" 0 "Nothing was changed" "arc-windfarm-edge" "Eventstream es-windfarm-edge"
run env ENV_FILE=/nonexistent/demo.env bash "$CLEAN"
check "clean-up without demo.env and without settings: says what it needs" 1 "give at least SUBSCRIPTION_ID and RESOURCE_GROUP"

azure_state
run bash "$CLEAN" --fabric --fabric-workspace
check "--fabric with --fabric-workspace: refuses the combination" 1 "not both" "!--method delete"
echo vm-windfarm-edge > "$STUB_DIR/hostname"
run bash "$CLEAN" --azure --yes
check "clean-up on the edge VM: stops" 1 "not on the edge VM" "!group delete"

# ---- app/create-app.sh: the Fabric app of Phase 4 is put together from the template, its functions pack
# and the overlay. node, npm and npx are stand-ins (stubs-app); a copy of the app folder is used, so the
# repository gets no app/windfarm-twin.
chmod +x "$HERE"/stubs-app/*
APPDIR="$SCRATCH/app"; CREATE="$APPDIR/create-app.sh"
app_reset() { reset; rm -rf "$APPDIR"; mkdir -p "$APPDIR"; cp -R "$REPO/app/overlay" "$APPDIR/overlay"; cp "$REPO/app/create-app.sh" "$CREATE"; }
app_run() { OUT="$(PATH="$HERE/stubs-app:$PATH" bash "$CREATE" "$@" 2>&1)"; RC=$?; }
W="$APPDIR/windfarm-twin"

app_reset; app_run
OUT="$OUT
app:$(grep -c "TwinApp" "$W/packages/frontend/src/App.tsx") twin:$([[ -f "$W/packages/frontend/src/twin/scene/SceneEngine.ts" ]] && echo yes) fn:$(grep -c "getLiveState" "$W/packages/functions/src/function_app.ts") title:$(grep -c "Northwind Ridge" "$W/packages/frontend/index.html")"
check "create-app, fresh: scaffolds at the pinned version, adds the pack, copies the twin, installs three.js, checks" 0 "create-rayfin@2.0.1 --project-name windfarm-twin --template blankapp" "npm run pack:add -- functions (in windfarm-twin)" "app:[1-9]" "twin:yes" "fn:[1-9]" "title:1" "three@0.187.0" "@types/three@0.187.0" "npm run typecheck (in windfarm-twin)" "npx rayfin up --workspace WindFarmDigitalTwin"

: > "$STUB_DIR/calls.log"; echo "// edited by hand" > "$W/packages/frontend/src/twin/TwinApp.tsx"; app_run
OUT="$OUT
restored:$(grep -c "edited by hand" "$W/packages/frontend/src/twin/TwinApp.tsx")"
check "create-app, run again: keeps the app, adds nothing twice, copies the overlay again" 0 "keeping it" "already there" "already a dependency" "restored:0" "npm run typecheck (in windfarm-twin)" "!create-rayfin" "!pack:add" "!npm install"

: > "$STUB_DIR/calls.log"; app_run --overlay
check "create-app --overlay: copies only" 0 "Copied the twin" "!create-rayfin" "!npm run typecheck (in" "!npm install"

app_reset; echo "v20.19.0" > "$STUB_DIR/node_version"; app_run
check "create-app, Node.js 20: stops before anything is created" 1 "Node.js 20.19.0 is too old" "!create-rayfin"

app_reset; echo "10.9.9" > "$STUB_DIR/npm_version"; app_run
check "create-app, npm 10: says what was seen with it, and goes on" 0 "edgesOut" "npm install -g npm@latest" "create-rayfin@2.0.1"

app_reset; touch "$STUB_DIR/scaffold_fails"; app_run
check "create-app, the scaffolder creates nothing: stops and says so" 1 "ended without creating" "!pack:add"

app_reset; touch "$STUB_DIR/pack_fails"; app_run
check "create-app, the functions pack creates nothing: stops and says so" 1 "did not create packages/functions" "!typecheck"

app_reset; touch "$STUB_DIR/typecheck_fails"; app_run
check "create-app, the check fails: the app is not called ready" 1 "not ready to deploy" "!The app is ready"

app_reset; mkdir -p "$W"; echo notes > "$W/notes.txt"; app_run
check "create-app, a folder of that name that is no app: leaves it alone" 1 "not a Rayfin project" "!create-rayfin"

app_reset; app_run --force
check "create-app, unknown option: refuses" 1 "Unknown option --force" "!create-rayfin"

app_reset; app_run --overlay
check "create-app --overlay without an app: says to run without the option" 1 "not a Rayfin project"

echo; echo "passed $pass, failed $fail"; [[ $fail -eq 0 ]]
