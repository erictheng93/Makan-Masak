# i18n Locale Handoff

The current CSV is the 2026-09-30 handoff copied from the app locale files.
`locale-approval-manifest.json` pins its SHA-256 and records the review history.
The latest addendum includes 30 billing cells reviewed by Codex and re-approved
at the maintainer's explicit instruction; earlier translations remain unchanged.
The previous review covered the 60 cells in `REVIEW-CHECKLIST.md`, signed by
Claude at the maintainer's instruction. No native speaker has read the machine
translations; known tone issues remain. The 2026-05-26 approval covers the CSV at
commit `a2ece23b`.

`locale-translator-handoff.csv` is the source handoff for completing the app
locales that were previously stubbed:

- `apps/admin-dashboard`: `en-US`, `zh-CN`, `ja-JP`, `vi-VN`, `id-ID`
- `apps/kitchen-display`: `zh-CN`, `vi-VN`, `ms-MY`, `id-ID`
- `apps/onboarding-app`: `zh-CN`, `vi-VN`, `ms-MY`, `id-ID`
- `apps/management-portal`: `zh-CN`, `vi-VN`, `ms-MY`, `id-ID`

Each row contains the app name, dot-path key, Traditional Chinese source text,
an English secondary source (empty for admin, where `en-US` is a target), and
one column for each target locale.

To regenerate the handoff after source copy changes:

```sh
pnpm exec tsx scripts/i18n-locale-coverage.ts --export-handoff
```

The export preserves any already-filled target cells for matching `app` + `key`
rows. After source copy changes, review those preserved cells against the new
source text before seeking approval.

After the target columns have been reviewed and accepted by the project
maintainer, import the approved CSV:

```sh
pnpm run i18n:check-handoff -- docs/i18n/locale-translator-handoff.csv
pnpm run i18n:import-handoff -- docs/i18n/locale-translator-handoff.csv
```

The check/import validates that every `zh-CN`, `vi-VN`, `ms-MY`, and `id-ID`
cell is filled for every current source key. The check command is read-only; the
import command performs the same validation before writing locale files. Both
commands also validate `locale-approval-manifest.json`, which records the
approved handoff SHA-256, approval date, reviewer or maintainer acceptance,
covered apps, and covered locales.

Changed locale files are rewritten in full, which removes comments; review
`git diff` after importing. Unchanged files are not written. Preserving comments
and formatting is tracked in [#430](https://github.com/erictheng93/Makan-Masak/issues/430).

To check whether target locales still have fewer leaf keys than `zh-TW`:

```sh
pnpm run check:i18n-locales
```

The default CI check emits warnings rather than failing so source-copy changes
can be exported and reviewed before target locale updates land. Once the
approved CSV has been imported, use the strict gate before declaring the work
complete:

```sh
pnpm run check:i18n-locales:strict
```

A locale stub replacement can be declared complete only after:

1. The target columns in `locale-translator-handoff.csv` have explicit
   maintainer acceptance. External translator approval is preferred when
   available, but this project currently accepts AI-assisted machine
   localization because external translator resources are unavailable.
2. `locale-approval-manifest.json` records the approved handoff SHA-256 and
   reviewer or maintainer metadata.
3. `pnpm run i18n:check-handoff -- docs/i18n/locale-translator-handoff.csv`
   passes.
4. `pnpm run i18n:import-handoff -- docs/i18n/locale-translator-handoff.csv`
   has generated the target locale files.
5. `pnpm run check:i18n-locales:strict` passes.
