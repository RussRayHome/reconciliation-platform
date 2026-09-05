# Contributing to reconciliation-platform

Kinney Software Solutions LLC — change control policy.

## The rule

**No issue, no branch. No pull request, no merge.**

Every modification to this repository must be traceable to a GitHub Issue, and
every change must reach a protected branch through a pull request that links
that issue. Pushing code directly to a protected branch is not permitted, and
a pull request without a linked issue is not eligible to merge.

This exists so that any commit in the history can be traced back to a written
reason, and so that a reviewer, an auditor, or a future maintainer can answer
"why does this line exist?" without archaeology.

## Protected branches

| Branch  | Role | Direct pushes |
| ------- | ---- | ------------- |
| `dev`   | Default and integration branch. All feature work merges here first. | Not permitted |
| `stage` | Pre-release validation. | Not permitted |
| `main`  | Release branch. | Not permitted |

`dev` is the repository's default branch. This matters mechanically: GitHub
interprets pull request closing keywords **only** when the pull request targets
the default branch, so `Closes #123` in a PR into `dev` creates a real, native
issue link and closes the issue on merge. The same keyword in a PR targeting
`stage` or `main` is ignored and creates no link. Promotion PRs into `stage` and
`main` should therefore reference the issues they carry with `Refs #123` and
rely on the original `dev` PR for the audit trail.

## Workflow

### 1. Start from an issue

Every change begins with a GitHub Issue. If one does not exist, open it before
writing code. An acceptable issue states:

- **What** is wrong or missing, in a sentence a non-author can understand
- **Why** it matters — the failure, the risk, or the requirement it serves
- **Acceptance criteria** — how we will know it is done

Issues that are a title and nothing else are not a basis for a change.

### 2. Branch from `dev`

Branch names carry the issue number:

```
<type>/<issue-number>-<short-slug>
```

Where `<type>` is one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`,
`perf`, or `build`. Examples:

```
fix/313-alias-lookup-containment
feat/277-collapse-validation-tables
chore/306-retire-qbo-naming
```

The slug is lowercase, hyphen-separated, and short enough to read in a branch
list. The issue number is not optional.

### 3. Commit with the issue reference

Commits follow Conventional Commits, with the issue number in the subject:

```
<type>(<scope>): <summary> (#<issue>)
```

Examples:

```
feat(validation): collapse four validation tables into two (#277)
fix(matching): score payee alias lookup by containment (#313)
chore(scripts): regenerate the dev seed from the real pipeline (#308)
```

A commit that touches more than one issue names each one: `... (#277), (#310)`.

Every commit on the branch carries a reference. The requirement is per-commit,
not per-branch, because commits are what survive into the history — a squash
merge inherits the pull request title, so that title must satisfy the same
format.

### 4. Open a pull request

The pull request targets `dev` and **must** link its issue in the description
using a closing keyword on its own line:

```
Closes #313
```

Accepted closing keywords: `close`, `closes`, `closed`, `fix`, `fixes`,
`fixed`, `resolve`, `resolves`, `resolved`. Use `Refs #313` for an issue the
pull request advances but does not finish.

A link typed into the PR body is what creates GitHub's native issue-to-PR
relationship. Mentioning the issue in a comment after the fact does not.

The pull request description states what changed and how it was verified.
"See the issue" is not a description — the issue says what should happen, the
pull request says what was done.

### 5. Merge

- All required checks pass.
- Squash merge, so that one issue produces one commit on `dev`.
- The squash commit subject keeps the `(#issue)` reference.
- Delete the branch after merge.

## Enforcement

Policy that lives only in a document is a suggestion. These rules are enforced
by a repository ruleset on `dev`, `stage` and `main`:

| Requirement | Mechanism |
| ----------- | --------- |
| No direct pushes to protected branches | Ruleset: **Require a pull request before merging** |
| No force-pushing over history | Ruleset: **Block force pushes** |
| Protected branches cannot be deleted | Ruleset: **Restrict deletions** |
| Commit messages contain an issue reference | Ruleset: **Restrict commit metadata** — commit message must match `#[0-9]+` |
| Branch names contain an issue number | Ruleset: **Restrict branch names** — must match `^(feat\|fix\|chore\|docs\|refactor\|test\|perf\|build)/[0-9]+-[a-z0-9-]+$` |
| Pull request links an issue | Status check — see below |

**One requirement has no native rule.** GitHub rulesets cannot require that a
pull request link an issue. That check is a workflow that reads the pull
request body for a closing keyword and fails if it finds none. It runs in
seconds and is marked as a required status check; it is deliberately separate
from the full validation suite so that a missing issue link fails fast instead
of after a fifty-minute build.

Note also GitHub's own framing of metadata rules: they are intended to increase
consistency between commits, and are explicitly *not* a substitute for
requiring review through pull requests. The commit-message pattern is a
convenience that keeps the history greppable — the pull request requirement is
the actual control.

### Rollout

The ruleset is first enabled with enforcement status **Evaluate**. In this mode
GitHub records what *would* have been blocked without blocking anything, which
surfaces mismatched branch names and unreferenced commits before they can
interrupt work. Once the evaluation log is clean, enforcement moves to
**Active**.

## Exceptions

There is no standing bypass. If a production defect requires a change faster
than this process allows, the change still goes through a pull request — open
the issue, branch, and PR in that order, and merge as soon as checks pass. The
process costs minutes; an untraceable commit costs an audit finding.

If a ruleset bypass is ever exercised, the reason is recorded in an issue
opened the same day, referencing the commit SHA that bypassed the control.

## Related

- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and secret handling
- [Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)
- [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Conventional Commits](https://www.conventionalcommits.org/)
