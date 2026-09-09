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
    // THE invariant of this screen: never stage a file the submission discards. `POST
    // /api/imports/runs` registers multer fields for bankFiles and glFile only, and
    // `assertBankOrGl` (importValidationService.ts) throws on any other source type -- so a run
    // physically cannot carry AP, AR or payroll today. A drop zone for one of them would take a
    // file, show it in the recap, and lose it on submit: data loss with a footnote.
    //
    // When the submit path widens, this list widens with it -- and this test is what makes that
    // ordering impossible to get backwards.
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
