/**
 * Structural checks on Liquibase formatted-SQL changesets, run before anything touches a database.
 *
 * WHY THIS EXISTS. Liquibase's formatted-SQL parser treats a comment whose first word is `changeset`
 * or `rollback` as a DIRECTIVE, not prose. So an ordinary English sentence fails the whole changelog
 * the moment a line happens to wrap in the wrong place:
 *
 *     -- 2a/2b). Adds the four columns and the one status the pathway needs; the table itself is
 *     -- changeset 0039's.                      <-- parsed as a malformed --changeset directive
 *
 * That is the entire bug. The author knew the rule, wrote a normal sentence, and the WRAP put the
 * word at the start of a line. It has now happened twice, and the second time it was already
 * written down -- which is the evidence that knowing it is not a control. A check is.
 *
 * The failure it prevents is cheap to detect and expensive to hit: the changelog fails to parse, so
 * every database-backed test dies at setup with "Unexpected formatting in formatted changelog",
 * naming a line number but not the reason.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CHANGESET_DIR = 'packages/persistence/liquibase/changesets';

/**
 * A comment line whose first token is `changeset` or `rollback` but which is NOT written as the
 * tight directive form (`--changeset` / `--rollback`).
 *
 * The tight form is deliberate and correct. The spaced form is always an accident -- Liquibase
 * strips the whitespace and parses it as a directive anyway, so prose cannot use those words at the
 * start of a comment line. Mid-line is fine, which is why "(changeset 0059)" reads happily in 0079.
 */
const DIRECTIVE_LOOKALIKE = /^--\s+(changeset|rollback)\b/i;

const problems: string[] = [];

for (const file of readdirSync(CHANGESET_DIR).filter((name) => name.endsWith('.sql')).sort()) {
  const lines = readFileSync(join(CHANGESET_DIR, file), 'utf8').split('\n');

  lines.forEach((line, index) => {
    const match = DIRECTIVE_LOOKALIKE.exec(line);
    if (!match) {
      return;
    }

    problems.push(
      `${file}:${index + 1}  comment line begins with "${match[1]}", which Liquibase parses as a directive\n` +
        `    ${line.trim()}\n` +
        `    Fix: rewrap the sentence so the word is not the first token on the line.`,
    );
  });
}

if (problems.length > 0) {
  console.error(
    `Liquibase changeset check failed -- ${problems.length} directive-lookalike comment line(s):\n\n` +
      problems.join('\n\n'),
  );
  process.exit(1);
}

console.log(
  `Liquibase changeset check passed: ${readdirSync(CHANGESET_DIR).filter((n) => n.endsWith('.sql')).length} changesets, no directive-lookalike comments.`,
);
