import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #448 / #481. The 5a/5b interim scope notice says entity ids are "not yet checked against
 * imported files". Its removal condition is a **rendered** AP/AR drop zone — not the existence of
 * the code that would check them.
 *
 * That distinction is the whole point of this test, because getting it wrong shipped. #471 built
 * `detectSubledgerEntityRejection` and wired it into `SourceDropZone`'s subledger mode, which read
 * as "registry validation landed", so #481 took the notice out. But that mode is rendered nowhere:
 * `App.tsx`'s only `<SourceDropZone>` is `mode="bank-gl"`, and the AP/AR tabs are `kind: 'reason'`
 * panels per 08_PHASE2_RULINGS Branch B. No user could upload an AP or AR file, so nothing ever
 * reached the check — and the screen stopped warning about a gap that was still there.
 *
 * A static read rather than a render test: the invariant is a relationship between two files, and
 * the thing that went wrong was reasoning about reachability, which a render of one component in
 * isolation cannot see.
 */

const SRC = join(__dirname, '..');
const read = (relativePath: string): string => readFileSync(join(SRC, relativePath), 'utf-8');

describe('5a/5b registry scope notice', () => {
  const rendersSubledgerDropZone = (): boolean =>
    /<SourceDropZone[^>]*\n?\s*mode="subledger"/.test(read('App.tsx'));

  const hasScopeNotice = (): boolean =>
    read('components/SubledgerEntitiesScreen.tsx').includes('registry-scope-notice');

  it('is present while no AP/AR drop zone is rendered, and gone once one is', () => {
    expect(
      hasScopeNotice(),
      rendersSubledgerDropZone()
        ? 'App.tsx now renders a subledger drop zone, so AP/AR files can reach the registry ' +
          'check. Remove the scope notice from SubledgerEntitiesScreen.tsx (and its CSS) in that ' +
          'same changeset — leaving it behind understates the product.'
        : 'No subledger drop zone is rendered, so no AP/AR file can reach the registry check. ' +
          'The scope notice must stay: without it 5a/5b read as authoritative when nothing ' +
          'validates against them. The signal to remove it is a rendered drop zone, not the ' +
          'existence of detectSubledgerEntityRejection.',
    ).toBe(!rendersSubledgerDropZone());
  });

  it('states the two registries are not yet checked, in the approved wording', () => {
    // "Approved copy -- do not reword" is on the component. A paraphrase that softened it would
    // pass the presence check above while losing the thing the notice exists to say.
    expect(read('components/SubledgerEntitiesScreen.tsx')).toContain(
      'not yet checked against imported files',
    );
  });
});
