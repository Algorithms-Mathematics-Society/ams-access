# Phase 2g exact PostgreSQL and restricted-role qualification

Completion date: 2026-07-24

Record-time baselines:

- cxxprobe `main`: `d365a87`;
- ams-golang `main`: `6d8ce94`; and
- ams-access `main`: `3647573`.

Record-time state: the Phase 2g harness changes and this record are local and
uncommitted. Phase 2d–2f implementation commits are pushed across the relevant
repositories; their audit records are pushed in ams-access.

No production or staging database connection, secret payload read, deployment,
Cloud SQL mutation, object-storage mutation, or client release was performed.

## Completion statement

Phase 2g closes the exact-major and obvious role-elevation gaps left by Phase
2f. Read-only Cloud SQL control-plane inspection identified the deployed
development instance as PostgreSQL 15, currently reporting maintenance build
`POSTGRES_15_17.R20260319.04_04`. The full migration suite was then run against
an isolated upstream PostgreSQL 15.17 server with separate administrative and
migration identities.

Only the administrative identity created and dropped disposable databases. The
production `db.Migrate` code path received a separate local connection
authenticated as the disposable migration role `ams_api`. That role had no
direct `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`
capability. Each disposable database was created with that restricted role as
owner, allowing the suite to exercise the DDL, extension, trigger,
advisory-lock, rollback, and concurrency behavior required by migrations
001–042 without giving the migration connection server-wide administrative
privileges.

This is exact upstream PostgreSQL-major qualification with a role restricted at
the cluster-attribute level. It is not a claim that a local upstream server
reproduces Cloud SQL's service wrapper, patched maintenance build, or the live
role's inherited memberships, schema ACLs, search path, object ownership, and
extension state. Database ownership is intentionally granted for migration DDL
and is distinct from a least-privileged steady-state runtime identity.

## Read-only Cloud SQL discovery

The configured organization account was used explicitly for read-only `gcloud`
describe/list operations without changing the active CLI account. The
repository's deployment configuration targets development/test resources; it
does not declare a production database.

| Property                       | Observed value                                |
| ------------------------------ | --------------------------------------------- |
| Instance                       | `ams-postgres-dev`                            |
| Connection name                | `ams-access-dev:asia-south1:ams-postgres-dev` |
| Region / availability          | `asia-south1` / zonal                         |
| State                          | `RUNNABLE`                                    |
| Database engine                | `POSTGRES_15`                                 |
| Current maintenance version    | `POSTGRES_15_17.R20260319.04_04`              |
| Available maintenance version  | `POSTGRES_15_18.R20260319.07_22`              |
| Databases visible in metadata  | `postgres`, `ams_access`                      |
| Database charset / collation   | UTF8 / `en_US.UTF8`                           |
| Cloud SQL users                | `ams_api`, `postgres`                         |
| Tier / connection setting      | `db-f1-micro` / `max_connections=100`         |
| TLS policy                     | `ALLOW_UNENCRYPTED_AND_ENCRYPTED`             |
| API service-account capability | includes `roles/cloudsql.client`              |

The Cloud Run repository deployment is named `ams-api-test`, sets `ENV=dev`,
and obtains an opaque `DB_URL` from Secret Manager. Neither the secret value nor
database contents were read. The Cloud SQL user list establishes that
`ams_api` exists, but repository configuration alone does not prove which
identity that secret selects.

## Harness change

`internal/db/migration_postgres_integration_test.go` now requires:

```text
AMS_TEST_DATABASE_ADMIN_URL
AMS_TEST_DATABASE_MIGRATION_URL
AMS_TEST_DATABASE_DISPOSABLE=1
```

The harness:

1. refuses partial configuration and still requires the explicit disposable
   acknowledgement;
2. parses both URLs and rejects empty or identical PostgreSQL users;
3. connects through the admin URL only to create and clean up one
   cryptographically suffixed `ams_migration_test_*` database;
4. creates that database with the migration user as owner;
5. registers exact-name cleanup immediately after successful creation so later
   connection or assertion failures do not leak the database;
6. exposes only the migration-role pool to the production `db.Migrate` path;
   and
7. queries `pg_roles` through that connection and fails unless `current_user`
   is the configured migration user and every prohibited direct role attribute
   is false.

The Go README now documents the two-identity invocation and the ownership and
privilege requirements.

## Exact PostgreSQL 15.17 environment

Official Ubuntu 24.04 PostgreSQL packages were downloaded and extracted into a
unique RAM-backed `/dev/shm` directory. No system package was installed. The
server accepted Unix-socket connections only; TCP listening was disabled.

| Package                                              | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `postgresql-15_15.17-1.pgdg24.04+1_amd64.deb`        | `db186eb11b5af796d77a46ca411861e232c8f10441ddbde0b4c18d71617f34c4` |
| `postgresql-client-15_15.17-1.pgdg24.04+1_amd64.deb` | `a2f145d29318fbf92d3ded83652c01e12d68277fcfedbb60f74aa05ea1207165` |
| `libpq5_16.14-0ubuntu0.24.04.1_amd64.deb`            | `a7000b8261d2139cb4a34dcb1e5a04e53ccea175e68499088401e40d5ae3c609` |

The disposable cluster used:

- PostgreSQL server `15.17`;
- admin role `ams_phase2_admin`;
- database owner and migration role `ams_api`;
- Unix socket `/dev/shm/ams-phase2g-pg15.FLGvBX/socket`; and
- no network listener or persistent data directory.

The temporary path and socket are evidence labels only. The server is stopped
and the entire unique directory is removed after the final leak check.

## Verification evidence

| Check                                            | Result                               |
| ------------------------------------------------ | ------------------------------------ |
| Restricted-role integration suite                | Passed on PostgreSQL 15.17           |
| Restricted-role suite repeated five times        | Passed; no lock-order flakes         |
| Restricted-role suite with Go race detector      | Passed                               |
| Integration-tag compile/skip with no environment | Passed                               |
| Integration-tag static analysis                  | `go vet` passed                      |
| Ordinary `internal/db` tests                     | Passed                               |
| Complete uncached Go suite                       | `go test -count=1 -p=2 ./...` passed |
| Complete Go static analysis                      | `go vet ./...` passed                |
| Complete Go build                                | `go build -p=2 ./...` passed         |

The test server contained no leaked `ams_migration_test_*` database after the
suite; only `postgres`, `template0`, and `template1` remained before shutdown.

## Independent final audit

A read-only subagent audit found no blocking defect. It confirmed that only the
migration pool reaches `db.Migrate`, cleanup is registered before later setup
can fail, identifiers and exact cleanup targets are safe, and current tests do
not parallelize the package-global pool. It identified the expected limitation
that direct role-attribute checks do not prove absence of effective privileges
inherited through memberships. That limitation is a remaining environment
qualification gate rather than a defect in this isolated harness.

## Remaining gates

Phase 2g does not authorize a production migration or claim a faithful copy of
the deployed Cloud SQL security context. Before rollout, an authorized operator
must capture read-only metadata for the actual connection identity:

1. `current_user`, direct role attributes, role memberships, and database owner;
2. `search_path`, database/schema privileges, default privileges, and existing
   object ownership;
3. installed and available `pgcrypto` versions plus Cloud SQL extension policy;
4. advisory-lock availability and any statement/lock timeout policy; and
5. the identity actually selected by the deployed `DB_URL` secret, without
   exposing its credential value.

That metadata must be reproduced in an isolated PostgreSQL 15/Cloud SQL staging
environment and the suite rerun there. The available PostgreSQL 15.18
maintenance update should also be evaluated before rollout so qualification
does not immediately lag the selected Cloud SQL maintenance version.

The next integration work package remains staging object-storage qualification:
generation-pinned quarantine reads, create-only canonical publication,
corruption/collision/private-file adversarial cases, and authenticated
projection asset delivery. Cross-platform desktop qualification and Phase 3
scored cxxprobe routing are still separate later gates.
