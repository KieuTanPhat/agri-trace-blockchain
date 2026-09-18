# Wireframe v1

## Internal Layout

```text
┌────────────────────────────────────────────────────────────┐
│ Top bar: logo | role switch mock | org | status             │
├──────────────┬─────────────────────────────────────────────┤
│ Sidebar      │ Page content                                 │
│ - Dashboard  │ ┌───────────────┐ ┌───────────────────────┐ │
│ - Cycles/Lots│ │ Summary state │ │ Allowed action panel  │ │
│ - Shipments  │ └───────────────┘ └───────────────────────┘ │
│ - QR Scan    │ ┌─────────────────────────────────────────┐ │
│ - IoT Sim    │ │ Timeline                                │ │
│ - Components │ └─────────────────────────────────────────┘ │
└──────────────┴─────────────────────────────────────────────┘
```

## ProductionCycle và Lot Detail

```text
Cycle: product, farm, cycleCode, plot, planting/care/sensor/harvest history
Lot: lotCode, harvest, quantity, state, shipment, retailer destination

[ActionPanel]
- Buttons come only from `allowedCommands`
- Disabled loading state while command submits
- API error mapped to 403/409/422/503 components

[Timeline]
- PRODUCTION_CYCLE_CREATED
- PLANTING_RECORDED
- CARE_RECORDED
- SENSOR_RECORDED
- HARVEST_RECORDED
- SHIPMENT_CREATED
- TRANSPORT...
```

## Public Trace

```text
Public header: product + current state + blockchain verification
Lot facts + ProductionCycle public summary
Timeline
Proof section: network, tx hash, data hash, recorded time
```

## QR Scan

```text
Scan screen
┌─────────────────────────────┐
│ Camera placeholder / upload │
└─────────────────────────────┘
[Manual lot/trace token input]
[Open public trace]
```

## IoT Simulator

```text
Device selector | ProductionCycle selector
Sensor type | Value | Unit | Timestamp UTC
[Send reading]
Status: queued / sending / accepted / rejected / retrying
Last payload preview
```
