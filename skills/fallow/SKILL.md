Use Fallow when repository quality, duplication, dead code, dependency hygiene, or PR-risk analysis is needed for TypeScript/JavaScript code.

Fallow docs: https://docs.fallow.tools
Package: https://www.npmjs.com/package/fallow

## Install/Run

- Prefer project package manager. In this repo, use Bun.
- One-off scan without changing dependencies:
  - `bunx fallow`
  - `bunx fallow dupes`
  - `bunx fallow dupes --format json`
- If user asks to add it permanently:
  - `bun add -d fallow`
- If installed locally:
  - `bunx fallow ...`

## Duplication Workflow

1. Run baseline duplicate scan:
   - `bunx fallow dupes --format json`
2. If output is large, save/parse JSON and report:
   - `stats.duplication_percentage`
   - `stats.clone_groups`
   - `stats.files_with_clones`
   - largest `clone_families` by `total_duplicated_lines`
3. Classify findings before recommending refactors:
   - Generated/schema files: usually ignore or baseline.
   - Migration snapshots: usually keep as-is unless project explicitly supports migration helpers.
   - App/shared package source: good refactor candidates.
4. For suspicious/high-value clones, inspect exact siblings:
   - `bunx fallow dupes --trace <fingerprint>`
5. Try broader modes only when needed:
   - `bunx fallow dupes --mode strict`
   - `bunx fallow dupes --mode mild`
   - `bunx fallow dupes --mode weak`
   - `bunx fallow dupes --mode semantic`
6. For CI thresholds/baseline:
   - `bunx fallow dupes --threshold 5`
   - `bunx fallow dupes --save-baseline`

## Useful Commands

- Full analysis: `bunx fallow`
- PR-style audit: `bunx fallow audit`
- JSON audit: `bunx fallow audit --format json`
- Health score: `bunx fallow health --score`
- Dead code: `bunx fallow dead-code`
- Fix preview: `bunx fallow fix --dry-run`
- Schema/capabilities: `bunx fallow schema`
- Init config: `bunx fallow init`

## Reporting Rules

- Lead with actionable, non-generated duplication.
- Mention generated/minified/skipped files separately.
- Do not recommend refactoring historical migrations unless user asks; PocketBase migration files are append-only history and duplication may be acceptable.
- If `apps/web/public/bangs.js` is skipped as minified/generated, suggest adding it to Fallow `ignorePatterns` or renaming it with `.min.js` only if maintaining Fallow config.
- Include exact file paths and line ranges when available.

## Repo Notes

- This repo uses Bun, not npm/pnpm/yarn.
- PocketBase migrations live in `pocketbase/migrations`; preserve migration structure.
- Treat generated `packages/api-types/src/openapi.ts` as generated API output unless user asks to change generator/source schema.
