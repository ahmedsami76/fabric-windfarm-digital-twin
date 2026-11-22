# Data flow: wind farm MQTT topics to the Fabric eventstream

`windfarm-to-fabric.template.json` is the Azure IoT Operations data flow that forwards the
wind farm topics from the local MQTT broker to the custom endpoint of the Fabric eventstream.
`infra/06-connect-edge-to-fabric.sh` fills in the two placeholders and applies it.

| Part | Setting |
|---|---|
| Source | Default endpoint (the local MQTT broker), six topic filters |
| Transformation | None. Messages are forwarded unchanged. |
| Destination | Data flow endpoint `fabric-eventstream` (Kafka protocol), topic = the eventstream's topic name |

The `_sim` and `_control` topics are not in the source list, so simulator commands and the
anomaly ground truth never leave the edge.

To change what is forwarded, edit the `dataSources` list and run step 6 again. To filter or
reshape messages at the edge, add a `BuiltInTransformation` operation between the source and
the destination; see "Create data flows in Azure IoT Operations" on Microsoft Learn.
