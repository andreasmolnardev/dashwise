# Branch Cleanup Report

Generated from current local refs and `origin/*` refs. Comparisons use current
`dev` (`83fc9e7c`) as active integration base and current `main`
(`30bb99c4`) as the protected production base.

Recommendations:

- **Keep**: active work, protected branch, or branch checked out in a worktree.
- **Delete**: no unique work remains relative to `dev`, or branch is already
  integrated into `dev`.
- **Review**: branch has unmerged work; inspect or merge deliberately before
  deleting.

## Per-Branch Recommendations

| Branch | State | Work found | Recommendation |
| --- | --- | --- | --- |
| `85-widgets` | Merged into `dev` | Widget/feed subscription changes from 2025-12-23 | Delete local and remote |
| `aio-dev-workflow` | Merged into `dev` | Saved news article workflow from 2026-06-30 | Delete remote |
| `aio-preview` | Merge-only divergence | No non-merge commits or net diff from `dev` | Delete remote |
| `andrew-dev` | Merged into `dev` | Version update from 2025-10-19 | Delete local and remote |
| `appearance-settings` | Merged into `dev` | Accent-color select outline fix from 2025-10-25 | Delete local and remote |
| `better-search` | Merged into `dev` | URL/search-bar behavior from 2025-11-07 | Delete local and remote |
| `build-fix` | Merged into `dev` | Production Docker Compose and README changes | Delete local and remote |
| `codex/tanstack-router` | Unmerged, active | TanStack Router migration; 65 files, 1,401 additions, 196 deletions | Keep; checked out in worktree |
| `config-fix` | Merged into `dev` | Karakeep debug/config merge from 2025-10-20 | Delete local |
| `dashdot` | Merged into `dev` | Search default-tab behavior | Delete local and remote |
| `detailed-builds` | Unmerged, stale | Build-date, Docker, and build documentation changes; 8 files | Review; merge selectively or delete |
| `dev` | Protected integration branch | Current integration head from 2026-07-17 | Keep |
| `dev-testenv` | Merged into `dev`, recent | Request logging and SSH monitoring URL property | Keep temporarily; delete after validation/workflow closes |
| `dockerfile-fix` | Merged into `dev` | SSO button/display fix | Delete local and remote |
| `docs/example-widget-reference` | Unmerged, recent | Example integration YAML documentation; 225-line change | Review; merge if still canonical, otherwise delete remote |
| `favicon-fallback` | Merged into `dev` | Screensaver favicon fallback behavior | Delete local and remote |
| `feat/tailscale-widget` | Merged into `dev` | Tailscale integration branch ending in revert commit | Delete remote |
| `fix` | Merged into `dev` | Version variable update | Delete local and remote |
| `fix-auth-redirects` | Merged into `dev` | Web auth redirect fix | Delete remote |
| `fix-mobile-frame-controls` | Unmerged, active | Mobile frame hover-control cooldown plus contract commits | Keep; recent active work |
| `frame-close-url-param` | Merged into `dev` | Frame close URL parameter | Delete remote |
| `icons-31-01-26` | Merged into `dev` | Generated icon update | Delete remote |
| `icons-a637d07f-20251226` | Merged into `dev` | Generated icon update | Delete remote |
| `integrations` | Unmerged, substantial | Modular integrations UI/API, Beszel integration, migrations; 26 files, 3,074 additions | Keep or archive deliberately; likely unfinished feature branch |
| `issue-191-news-topics` | Unmerged, recent | News topic grouping with backend/frontend/schema changes; 4 files | Keep; review and merge or continue |
| `issue-230-search-clear-tooltip` | Merged into `dev` | Search clear tooltip positioning | Delete remote |
| `jellyfin-tags` | Merged into `dev` | Jellyfin search tag | Delete local and remote |
| `jobs-status-monitoring` | Merged into `dev` | Job/status monitoring merge branch | Delete local and remote |
| `karakeep-client` | Merged into `dev` | Karakeep client integration | Delete local and remote |
| `karakeep-debug` | Merged into `dev` | Karakeep error handling/connectivity test | Delete local and remote |
| `legacy` | Merged into `dev` | Historical news-features merge branch | Delete remote |
| `link-settings-search-param` | Merged into `dev` | Link-group search parameter | Delete local and remote |
| `links-fix` | Merged into `dev` | Add-link query parameter and home-link shortcut | Delete remote |
| `links-id` | Unmerged, stale | Link settings rewrite plus weather/Karakeep cleanup; 6 commits | Archive or delete after confirming no downstream use |
| `links-settings-fix` | Merged into `dev` | Preserve link group after adding link | Delete local and remote |
| `links-widget` | Merged into `dev` | Links widget WIP branch | Delete remote |
| `local-timezone-glanceable` | Merged into `dev` | Weather cloud icon | Delete local and remote |
| `login-check` | Merged into `dev` | Login icon assets | Delete local and remote |
| `main` | Protected production base | Current production base is older than `dev` | Keep |
| `manual-widgetsadd` | Duplicate of `dev-testenv` | Points at same commit as `dev-testenv`; checked out in separate worktree | Delete after removing its worktree |
| `minor-tweaks` | Merged into `dev` | News description fallback | Delete local and remote |
| `mobile-layout` | Merged into `dev` | Mobile layout cleanup | Delete local and remote |
| `monitoring-v2` | Merged into `dev` | Monitoring timeline redesign | Delete local and remote |
| `more-appearance-improvements` | Merged into `dev` | Blur provider cleanup | Delete local and remote |
| `news-features` | Merged into `dev` | News feed/subscription request split | Delete remote |
| `news-feeds` | Merged into `dev` | RSS feed fetching patch; local branch is behind remote | Delete local and remote |
| `news-patch` | Merged into `dev` | RSS feed error/logging fix | Delete local and remote |
| `news-redesign` | Merged into `dev` | Feed refresh route and dashboard changes | Delete local and remote |
| `notifications-mark-as-read` | Merged into `dev` | Notification version/update branch | Delete remote |
| `notifications-topic-tokens` | Merged into `dev` | Re-fetch notification topics on change | Delete local and remote |
| `openapi` | Merged into `dev` | OpenAPI client and link-group preselection | Delete remote |
| `pb_migs` | Merged into `dev` | PocketBase build-context migration | Delete local and remote |
| `preview-test` | Merged into `dev` | Historical preview merge branch | Delete remote |
| `react-bun-rewrite` | Unmerged, active WIP | Screensaver redesign and Smart Frames changes; 6 files, 481 additions | Keep; recent WIP |
| `release` | Protected by GitHub Actions | Release workflow branch; old but intentionally retained | Keep; do not delete |
| `screensaver` | Merged into `dev` | Historical screensaver/favicon merge branch | Delete remote |
| `server-actions` | Merged into `dev` | Dependency/config cleanup from 2026-05-14 | Delete local and remote |
| `slider-improve` | Merged into `dev` | Docker Compose job-service test configuration | Delete local |
| `stable-release` | Merge-only divergence | Historical release merge with no non-merge work beyond `dev` | Delete remote |
| `status-checks` | Unmerged, very stale | Link status/CORS workaround; 1 commit, 2 files | Archive or delete after confirming workaround is obsolete |
| `sunrise-sunset-glanceable` | Merged into `dev` | Sunrise/sunset glanceable | Delete local and remote |
| `tag-search` | Merged into `dev` | Command-bar icon rendering | Delete local and remote |
| `tanstack-query-mig` | Unmerged, active | TanStack Query migration, Valkey feed cache, generated API changes; 49 files, 1,682 additions | Keep; current checked-out branch |
| `unified-contracts` | Unmerged, active | API contract pipeline/docs; local branch is one commit ahead of remote | Keep local; push/update remote before cleanup |
| `update-job` | Merged into `dev` | PocketBase version migration | Delete local and remote |
| `updated-pipelines` | Merged into `dev` | Release pipeline update | Delete local and remote |
| `wallpaper-appearance` | Merged into `dev` | Wallpaper filter loading | Delete local and remote |
| `wallpaper-patch` | Merged into `dev` | Historical wallpaper retrieval refactor | Delete remote |
| `weather-details-default-location` | Merged into `dev` | Weather default-location/rain message change | Delete local and remote |
| `widget-options` | Merged into `dev` | Integration widget dropdown | Delete local and remote |
| `widgets` | Merged into `dev` | Historical widget merge branch | Delete local and remote |
| `copilot/remove-getweatherdata-functions` | Unmerged, stale | Weather resolver refactor; 6 commits, 5 files, 355 additions | Review carefully; merge if needed, otherwise delete remote |
| `copilot/rewrite-file-structure` | Unmerged, stale | Route structure and PocketBase filter escaping; 2 commits, 6 files | Review security fix, then merge or delete remote |

## Immediate Cleanup Recommendation

Safe cleanup set: every branch marked **Delete**, excluding `release`, `main`,
and `dev`. Preserve active worktree branches until worktrees are removed.

Before deleting the unmerged branches, inspect these highest-value candidates:

1. `codex/tanstack-router`
2. `tanstack-query-mig`
3. `integrations`
4. `fix-mobile-frame-controls` / `unified-contracts`
5. `issue-191-news-topics`
6. `react-bun-rewrite`
7. `copilot/remove-getweatherdata-functions`
8. `copilot/rewrite-file-structure`

Untracked `plans/` was present before this report and was not modified.
