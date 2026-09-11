/**
 * Post-merge issue audit: given a merged PR, report what it left behind.
 *
 * WHY THIS EXISTS. Two failures kept recurring on 2026-09-10, both mechanical, both caught by the
 * product owner rather than by me:
 *
 *   1. #463's work shipped in PR #470 with `refs #463` where it warranted `Closes #463`. The issue
 *      stayed open after it was finished. "I DO NOT want any Issues hanging around after the work is
 *      completed. I can't measure progress accurately."
 *   2. Four children of #394 closed across nine PRs and the parent was never updated, so the one
 *      place progress is actually read from was the stalest thing in the repo.
 *
 * Neither is a judgement call. Both are "read the PR body, look up the issues, compare" -- which is
 * what this does, so it stops depending on anyone remembering.
 *
 * Usage:
 *   npm run issues:audit -- 476          # one PR
 *   npm run issues:audit -- --recent 10  # the last N merged PRs
 */
import { execFileSync } from 'node:child_process';

type IssueRef = { number: number; closing: boolean };

const gh = (...args: string[]): string =>
  execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

/**
 * Closing keywords per GitHub, matched only when they immediately precede the reference. `refs #N`
 * and `part of #N` deliberately do NOT close -- that distinction is the whole point, and getting it
 * backwards is what produced the #310 incident (a closing keyword fired from inside prose).
 */
const CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
const ANY_REF = /#(\d+)/g;

const parseRefs = (body: string): IssueRef[] => {
  const closing = new Set<number>();
  for (const match of body.matchAll(CLOSING)) {
    closing.add(Number(match[3]));
  }

  const all = new Map<number, IssueRef>();
  for (const match of body.matchAll(ANY_REF)) {
    const number = Number(match[1]);
    all.set(number, { number, closing: closing.has(number) });
  }

  return [...all.values()].sort((a, b) => a.number - b.number);
};

type IssueState = { number: number; state: string; title: string; parent?: number };

const readIssue = (number: number): IssueState | null => {
  try {
    const raw = gh('issue', 'view', String(number), '--json', 'number,state,title,body');
    const data = JSON.parse(raw) as { number: number; state: string; title: string; body: string };
    // "Part of #N" is this repo's convention for naming a parent in the body.
    const parent = /\bpart of #(\d+)/i.exec(data.body ?? '');
    return {
      number: data.number,
      state: data.state,
      title: data.title,
      parent: parent ? Number(parent[1]) : undefined,
    };
  } catch {
    return null;
  }
};

const auditPr = (prNumber: number): { openButReferenced: IssueState[]; parents: Set<number> } => {
  const raw = gh('pr', 'view', String(prNumber), '--json', 'number,title,body,state,mergedAt');
  const pr = JSON.parse(raw) as {
    number: number;
    title: string;
    body: string;
    state: string;
    mergedAt: string | null;
  };

  console.log(`\nPR #${pr.number} [${pr.state}] ${pr.title}`);

  const refs = parseRefs(`${pr.title}\n${pr.body ?? ''}`).filter((ref) => ref.number !== pr.number);
  if (refs.length === 0) {
    console.log('  no issue references');
    return { openButReferenced: [], parents: new Set() };
  }

  const openButReferenced: IssueState[] = [];
  const parents = new Set<number>();

  for (const ref of refs) {
    const issue = readIssue(ref.number);
    if (!issue) {
      console.log(`  #${ref.number} — could not read (may be a PR, not an issue)`);
      continue;
    }

    if (issue.parent) {
      parents.add(issue.parent);
    }

    const keyword = ref.closing ? 'Closes' : 'refs';
    const flag =
      ref.closing && issue.state === 'OPEN'
        ? '  <-- CLOSING KEYWORD BUT STILL OPEN'
        : !ref.closing && issue.state === 'OPEN'
          ? '  <-- open; is the work actually finished?'
          : '';

    console.log(`  #${issue.number} [${issue.state}] via "${keyword}" — ${issue.title.slice(0, 60)}${flag}`);

    if (issue.state === 'OPEN') {
      openButReferenced.push(issue);
    }
  }

  return { openButReferenced, parents };
};

const argv = process.argv.slice(2);
const recentIndex = argv.indexOf('--recent');
const prNumbers: number[] =
  recentIndex >= 0
    ? (JSON.parse(
        gh('pr', 'list', '--state', 'merged', '--limit', argv[recentIndex + 1] ?? '10', '--json', 'number'),
      ) as Array<{ number: number }>).map((entry) => entry.number)
    : argv.filter((token) => /^\d+$/.test(token)).map(Number);

if (prNumbers.length === 0) {
  console.error('Usage: npm run issues:audit -- <prNumber...>   |   -- --recent <n>');
  process.exit(1);
}

const allParents = new Set<number>();
let openCount = 0;

for (const prNumber of prNumbers) {
  const { openButReferenced, parents } = auditPr(prNumber);
  openCount += openButReferenced.length;
  parents.forEach((parent) => allParents.add(parent));
}

if (allParents.size > 0) {
  console.log('\nParent issues touched by this work — check each has a current status comment:');
  for (const parent of [...allParents].sort((a, b) => a - b)) {
    const issue = readIssue(parent);
    console.log(`  #${parent} ${issue ? `[${issue.state}] ${issue.title.slice(0, 60)}` : '(unreadable)'}`);
  }
}

console.log(
  `\n${openCount} referenced issue(s) still open. Open is fine when the work genuinely is not done -- ` +
    'the point is that it should be a decision, not an oversight.',
);
