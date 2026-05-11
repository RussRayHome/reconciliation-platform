# Branch Protection Recommendations

Use these settings on `main` to ensure quality and security gates are enforced before merge.

## Required Status Checks

Enable **Require status checks to pass before merging** and mark these checks as required:

- `Docker Validate / test`
- `Docker Validate / security-scan`
- `Docker Validate / docker-validate`

These map to jobs in `.github/workflows/docker-validate.yml` and cover:

- unit and integration tests (`npm run test`)
- security scan (`npm run security:scan`)
- static checks and docker validation (`npm run typecheck`, `npm run lint`, docker config/build/smoke)

## GitHub UI Setup

1. Go to repository **Settings** -> **Branches**.
2. Add or edit the protection rule for `main`.
3. Enable **Require status checks to pass before merging**.
4. Select all three checks listed above.
5. Save the rule.

If a check does not appear in the picker, run the workflow once from a pull request or branch push and refresh the rule editor.

## GitHub CLI Automation

If you are authenticated with GitHub CLI (`gh auth status`), you can apply the baseline required checks with:

```bash
npm run github:protect-main -- --repo <owner>/<repo>
```

Notes:

- If `--repo` is omitted, the helper tries `GITHUB_REPOSITORY` and then `git remote.origin.url`.
- Use `--dry-run` to preview changes without calling the GitHub API.
- The helper merges these required checks into existing protection if one already exists, and only creates a baseline rule when no protection exists yet.

## Optional Hardening

Consider also enabling:

- **Require branches to be up to date before merging**
- **Require a pull request before merging**
- **Require approvals** (team policy)
