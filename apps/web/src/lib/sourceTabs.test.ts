import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SOURCE_TAB,
  sourceTabMeta,
  findSourceTab,
  isDroppable,
  resolveSourceTab,
  sourceTabIds,
  sourceTabs,
} from './sourceTabs';

describe('sourceTabs', () => {
  it('carries all five source types a run can hold', () => {
    expect(sourceTabs.map((tab) => tab.id)).toEqual(['bank', 'gl', 'ap', 'ar', 'payroll']);
  });

  it('gives every tab a distinct hue', () => {
    // AP was byte-identical to GL until all five had to share one strip (Phase 0b). A duplicate
    // here is invisible in review and only shows up as two tabs the same colour.
    const hues = sourceTabs.map((tab) => tab.hueToken);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('models payroll as a reason, never as a droppable tab', () => {
    // [OBJECT] rule 27: a control a user may not use is removed and replaced by a reason, not
    // greyed out. The union makes a disabled drop zone unrepresentable rather than merely
    // discouraged.
    const payroll = findSourceTab('payroll');
    expect(payroll?.kind).toBe('reason');
    expect(payroll && isDroppable(payroll)).toBe(false);
    expect(payroll?.kind === 'reason' && payroll.trackingIssue).toBe('#408');
  });

  it('never offers a drop zone for a source the submission cannot carry', () => {
    // THE invariant of this screen: never stage a file the submission discards. A drop zone for a
    // source the submission drops would take a file, show it in the recap, and lose it on submit:
    // data loss with a footnote.
    //
    // STATUS as of #463: the submit path HAS widened. `POST /api/imports/runs` now registers multer
    // fields for the three subledgers, and a file sent on one is persisted (roles AP_1/AR_1/
    // PAYROLL_1). So the transport reason for this list to stay at bank+gl is gone.
    //
    // It stays at bank+gl for a different and still-live reason: a stored subledger contributes
    // nothing to the run's verdict yet. importValidationService skips it by role, so it is retained
    // and re-downloadable but validated against nothing. Offering a drop zone now would not lose the
    // file -- it would imply a check that does not happen, which is the same false negative in a
    // different costume.
    //
    // This list widens when validation does, not when transport did: AP with registry validation
    // (#448), AR when its rules land, payroll with #408. This test is what keeps that ordering
    // honest, and it is why #463 landed first.
    expect(sourceTabs.filter(isDroppable).map((tab) => tab.id)).toEqual(['bank', 'gl']);
  });

  it('requires both of the types it does accept', () => {
    const required = sourceTabs.filter((tab) => isDroppable(tab) && !tab.optional).map((t) => t.id);
    expect(required).toEqual(['bank', 'gl']);
  });

  it('allows 1-4 bank statements and exactly one GL workbook', () => {
    const bounds = Object.fromEntries(
      sourceTabs.filter(isDroppable).map((tab) => [tab.id, [tab.min, tab.max]]),
    );
    expect(bounds).toEqual({ bank: [1, 4], gl: [1, 1] });
  });

  it('keeps issue numbers out of user-facing copy', () => {
    // "arrives with registry validation" ages better than "#448", which may slip again now that
    // #463 blocks it. The tracking issue stays in the model for code cross-reference; it must not
    // reach a headline or a reason.
    for (const tab of sourceTabs) {
      if (tab.kind !== 'reason') continue;
      expect(tab.headline).not.toMatch(/#\d/);
      expect(tab.reason).not.toMatch(/#\d/);
    }
  });

  it('tells a reason tab reader what to do now, not only what is missing', () => {
    // A reader who cannot attach the file still has this month's reconciliation to finish. Every
    // reason panel names the path that works today.
    for (const tab of sourceTabs) {
      if (tab.kind !== 'reason') continue;
      expect(tab.headline).toMatch(/ledger|journal entry/i);
      expect(tab.reason.length).toBeGreaterThan(80);
      expect(tab.trackingIssue).toMatch(/^#\d+$/);
    }
  });

  describe('resolveSourceTab', () => {
    it('accepts every declared id', () => {
      for (const id of sourceTabIds) {
        expect(resolveSourceTab(id)).toBe(id);
      }
    });

    it('falls back rather than stranding an old or hand-edited link on a blank panel', () => {
      expect(resolveSourceTab(null)).toBe(DEFAULT_SOURCE_TAB);
      expect(resolveSourceTab('')).toBe(DEFAULT_SOURCE_TAB);
      expect(resolveSourceTab('billing')).toBe(DEFAULT_SOURCE_TAB);
      expect(resolveSourceTab('BANK')).toBe(DEFAULT_SOURCE_TAB);
    });
  });

  describe('sourceTabMeta', () => {
    const tab = (id: string) => findSourceTab(id)!;

    it('counts what is attached for a required type', () => {
      expect(sourceTabMeta(tab('bank'), 2)).toBe('2 of 4 accounts');
      expect(sourceTabMeta(tab('gl'), 1)).toBe('1 workbook');
    });

    it('reads "optional" rather than a zero count for a tab that takes no files', () => {
      // A "0 of 4" would imply the run is short of something it is not -- the same instinct as the
      // rail's badge rule (absent, not zero).
      expect(sourceTabMeta(tab('ar'), 0)).toBe('optional');
      expect(sourceTabMeta(tab('ap'), 0)).toBe('optional');
      expect(sourceTabMeta(tab('payroll'), 0)).toBe('optional');
    });

    it('switches a droppable type to a count once it carries files', () => {
      expect(sourceTabMeta(tab('bank'), 1)).toBe('1 of 4 accounts');
    });

    it('says a required type is required rather than showing zero', () => {
      expect(sourceTabMeta(tab('gl'), 0)).toBe('required');
    });
  });
});
