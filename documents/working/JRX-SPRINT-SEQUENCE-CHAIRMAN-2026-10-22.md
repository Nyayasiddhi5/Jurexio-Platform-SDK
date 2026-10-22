# Engineering sequence — Chairman Q6 (22 Oct 2026)

## Sprint 1

- **M09** Jurexio Ledger Core  
- **M11** CommandCentre (access evaluate, catalogue, role templates)  
- **M01** MatterCore Foundation (matter IDs, owners for downstream)  
- **M13** Storage Core  

**P0 gates (M09/M11):** registries adopted, IronLedger-style renames, event-bus annex, `POST /api/jrx/platform/access/evaluate`.

## Sprint 1b (before first production cutover)

- **M05** DeadlineGuard Deadline Core  
- **M12** PulseComms Alerting Core (in-app + email)  

Deadline Core requires MatterCore Foundation.

## Infrastructure (C-07)

Provision **ap-south-1** and **us-east-1** Ledger stacks via IaC in Sprint 1. No real client data in either region until both physical stacks exist. Dev/test may use logical `chain_id` on one database with **synthetic data only**.
