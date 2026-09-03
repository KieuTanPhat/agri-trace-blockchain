# Wireframe v1

## Internal Layout

```text
┌────────────────────────────────────────────────────────────┐
│ Top bar: logo | role switch mock | org | status             │
├──────────────┬─────────────────────────────────────────────┤
│ Sidebar      │ Page content                                 │
│ - Dashboard  │ ┌───────────────┐ ┌───────────────────────┐ │
│ - Batches    │ │ Summary state │ │ Allowed action panel  │ │
│ - Shipments  │ └───────────────┘ └───────────────────────┘ │
│ - QR Scan    │ ┌─────────────────────────────────────────┐ │
│ - IoT Sim    │ │ Timeline                                │ │
│ - Components │ └─────────────────────────────────────────┘ │
└──────────────┴─────────────────────────────────────────────┘
```

## Batch Detail

```text
Batch title + StateBadge + verification
Metadata: product, farm, batchCode, shipment, retailer destination

[ActionPanel]
- Buttons come only from `allowedCommands`
- Disabled loading state while command submits
- API error mapped to 403/409/422/503 components

[Timeline]
- CREATED
- PLANTED
- CARE_RECORDED
- SENSOR_RECORDED
- HARVEST_RECORDED
- SHIPMENT_CREATED
- TRANSPORT...
```

## Public Trace

```text
Public header: product + current state + blockchain verification
Batch facts
Timeline
Proof section: network, tx hash, data hash, recorded time
```

## QR Scan

```text
Scan screen
┌─────────────────────────────┐
│ Camera placeholder / upload │
└─────────────────────────────┘
[Manual batch/trace code input]
[Open public trace]
```

## IoT Simulator

```text
Device selector | Batch selector
Temperature input | Humidity input | Timestamp UTC
[Send reading]
Status: queued / sending / accepted / rejected / retrying
Last payload preview
```
