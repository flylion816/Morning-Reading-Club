## 1. Tests

- [x] 1.1 Add a package configuration test for main pages and subpackage routes.
- [x] 1.2 Extend package ignore tests for macOS metadata files.

## 2. Implementation

- [x] 2.1 Move low-frequency page declarations from `pages` to `subPackages` without changing routes.
- [x] 2.2 Generate `.DS_Store` ignore entries for root and nested asset directories.
- [x] 2.3 Regenerate root and miniprogram project configurations for the fanren tenant.
- [x] 2.4 Move subpackage-only admin services into their owning packages and group activity registrations with the workbench.
- [x] 2.5 Move additional non-tab detail workflows into subpackages and relocate their exclusive danmaku and ranking services.
- [x] 2.6 Move payment and WebSocket services into their owning packages, add a local activity payment confirmation adapter, and remove the unused notification badge component.

## 3. Verification

- [x] 3.1 Verify every declared main and subpackage page has JS and WXML files.
- [x] 3.2 Recalculate the main package raw size with current ignore and subpackage rules.
- [x] 3.3 Run the full miniprogram test suite.
- [x] 3.4 Validate the OpenSpec change in strict mode.
