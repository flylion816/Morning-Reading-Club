## 1. Specification and implementation

- [x] 1.1 Add structured disk usage collection for `/` with POSIX-safe parsing.
- [x] 1.2 Add threshold mapping and score breakdown without double-counting penalties.
- [x] 1.3 Add protected log cleanup module with lock, timeout, path allowlist, cooldown, and dry-run support.
- [x] 1.4 Clean application/PM2 logs and aged rotated logs without stopping services.
- [x] 1.5 Safely truncate only validated `morning-reading-*` Docker JSON logs; never touch data volumes or backups.
- [x] 1.6 Add post-cleanup verification and structured cleanup results to JSON/HTML reports.
- [x] 1.7 Add configuration for thresholds, retention days, cooldown, and dry-run mode.

## 2. Tests and validation

- [x] 2.1 Add unit tests for all disk thresholds and parse failure.
- [x] 2.2 Add filesystem tests for allowlists, rotated-log retention, lock/cooldown, and command failures.
- [x] 2.3 Run backend lint and targeted tests.
- [x] 2.4 Run `node backend/scripts/daily-log-report.js --test --hours 1` locally without email.
- [ ] 2.5 Validate production with dry-run first, then enable cleanup only after user confirmation.

## 3. Documentation

- [x] 3.1 Document cleanup safety boundaries and manual recovery commands.
- [x] 3.2 Document the 17:00 Asia/Shanghai schedule and the 05:00 alternative explicitly.
- [x] 3.3 Add the 2026-08-23 disk-full incident and prevention rule to the operations guide.
