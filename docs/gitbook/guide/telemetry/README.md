---
description: Enabling Telemetry for your BullMQ based applications
---

# Telemetry

BullMQ provides a Telemetry interface that can be used to integrate it with any external telemetry backends. Currently we support the [OpenTelemetry](https://opentelemetry.io) specification, which is the new de-facto standard for telemetry purposes, however the interface if flexible enough to support any other backends in the future.

Telemetry is very useful for large applications where you want to get a detailed and general overview of the system. For BullMQ it helps to gain insight in the different statuses a job may be during its complete lifecycle. In a large application it helpts tracking the source of the jobs and all the interactions the jobs or messages may perform with other parts of the system.

