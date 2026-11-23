#!/usr/bin/env bash
# Step 6 (run on your workstation or in Azure Cloud Shell, signed in as yourself).
# Creates the Azure IoT Operations data flow endpoint for the Fabric eventstream
# and the data flow that forwards the wind farm topics to it.
#
# Before running: the eventstream with a custom endpoint source must exist, and
# the Azure IoT Operations Arc extension identity must be a Contributor on the
# Fabric workspace (deployment guide, steps 6.4 and 6.5).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../config/load-env.sh"
need az sed
require SUBSCRIPTION_ID RESOURCE_GROUP AIO_INSTANCE_NAME EVENTSTREAM_BOOTSTRAP_SERVER EVENTSTREAM_TOPIC

ENDPOINT_NAME="${FABRIC_ENDPOINT_NAME:-fabric-eventstream}"
DATAFLOW_NAME="${DATAFLOW_NAME:-windfarm-to-fabric}"
HOST="$EVENTSTREAM_BOOTSTRAP_SERVER"
[[ "$HOST" == *:* ]] || HOST="${HOST}:9093"
[[ "$EVENTSTREAM_TOPIC" == es_* ]] || warn "EVENTSTREAM_TOPIC normally starts with 'es_'. Check the value."

require_user_login
az account set --subscription "$SUBSCRIPTION_ID"
az extension add --upgrade --yes --name azure-iot-ops

log "Creating data flow endpoint $ENDPOINT_NAME -> $HOST (system-assigned managed identity)"
az iot ops dataflow endpoint create fabric-realtime \
  --resource-group "$RESOURCE_GROUP" \
  --instance "$AIO_INSTANCE_NAME" \
  --name "$ENDPOINT_NAME" \
  --host "$HOST" \
  --auth-type SystemAssignedManagedIdentity \
  --output none

log "Creating data flow $DATAFLOW_NAME"
RENDER_DIR="$REPO_ROOT/edge/dataflows/rendered"
mkdir -p "$RENDER_DIR"
CONFIG_FILE="$RENDER_DIR/$DATAFLOW_NAME.json"
sed -e "s|__ENDPOINT_NAME__|$ENDPOINT_NAME|" -e "s|__EVENTSTREAM_TOPIC__|$EVENTSTREAM_TOPIC|" \
  "$REPO_ROOT/edge/dataflows/windfarm-to-fabric.template.json" > "$CONFIG_FILE"
az iot ops dataflow apply \
  --resource-group "$RESOURCE_GROUP" \
  --instance "$AIO_INSTANCE_NAME" \
  --profile default \
  --name "$DATAFLOW_NAME" \
  --config-file "$CONFIG_FILE" \
  --output none

log "Done"
az iot ops dataflow show --resource-group "$RESOURCE_GROUP" --instance "$AIO_INSTANCE_NAME" \
  --profile default --name "$DATAFLOW_NAME" \
  --query "{name:name, mode:properties.mode, state:properties.provisioningState}" --output table
info "Open the eventstream in Fabric. Events should appear in its data preview within a minute or two."
info "If nothing arrives, see docs/troubleshooting.md, section 'No events in the eventstream'."
