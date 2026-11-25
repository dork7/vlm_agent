# The assignment theme test still expects the retired Appearance label

Status: needs-triage

GitHub: https://github.com/dork7/vlm_agent/issues/9

## Reproduction

Run `npm test -- test/assign/login.test.ts` after installing dependencies with `npm ci`.

## Expected

The appearance test verifies the theme control used on the login page and unavailable Assignee links.

## Actual

The test fails at `test/assign/login.test.ts:118` because it expects the string `Appearance:` in the HTTP response. The rendered control now uses `Theme: System`, `Theme: Dark` and `Theme: Light`. In Chrome, both pages successfully cycled through all three settings, including switching the computed color scheme.

The full suite had one failure on both revisions tested. GitHub main commit `9962960cf6785531a1192f2bf654e5daac6cd37a` had 392 passes. Local commit `9450209202541d44beaa86915abd02e00f3d25da` had 367 passes.
