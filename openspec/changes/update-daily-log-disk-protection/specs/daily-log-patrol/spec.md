## ADDED Requirements

### Requirement: Disk usage is included in the daily patrol score

The daily server log patrol MUST collect the root filesystem usage as a numeric percentage and MUST expose the value and score deduction in both the HTML and JSON report.

#### Scenario: Disk below or at 90 percent
- **WHEN** the root filesystem usage is `90%` or lower
- **THEN** the disk deduction is `0` and the report still displays the measured percentage

#### Scenario: Disk exceeds 90 percent
- **WHEN** the root filesystem usage is greater than `90%` and no more than `95%`
- **THEN** the patrol deducts exactly `20` points for disk usage

#### Scenario: Disk exceeds 95 percent
- **WHEN** the root filesystem usage is greater than `95%` and less than `99%`
- **THEN** the patrol deducts exactly `50` points for disk usage

#### Scenario: Disk reaches 99 percent
- **WHEN** the root filesystem usage is `99%` or higher
- **THEN** the patrol deducts `100` points for disk usage and the final score is `0`

### Requirement: High disk usage triggers non-disruptive cleanup

The daily patrol MUST trigger protected log cleanup when the root filesystem usage is at least `90%`, without stopping, restarting, redeploying, or reconfiguring healthy online services.

#### Scenario: Cleanup at or above 90 percent
- **WHEN** the patrol measures root filesystem usage at or above `90%`
- **THEN** it attempts only allowlisted application, PM2, Docker JSON, and aged system log cleanup and records the result

#### Scenario: Cleanup does not touch business data
- **WHEN** cleanup runs
- **THEN** it MUST NOT delete or modify MongoDB/MySQL/Redis data volumes, backups, uploads, source code, or run any initialization/reset script

#### Scenario: Cleanup command fails
- **WHEN** a cleanup target is unavailable, permission is denied, or a command times out
- **THEN** the patrol still produces the daily report, records the failure, and does not restart the service to recover

#### Scenario: Concurrent patrols
- **WHEN** two patrol processes start at the same time
- **THEN** only one cleanup operation runs and the other records that cleanup was skipped because of the lock

### Requirement: Cleanup is auditable and reversible in operation

The patrol MUST report cleanup targets, bytes reclaimed, before/after disk usage, skipped reasons, and errors, and MUST support a dry-run mode for production validation.

#### Scenario: Dry-run validation
- **WHEN** the patrol is run with dry-run enabled
- **THEN** it reports the cleanup candidates and estimated actions without changing log files or service state
