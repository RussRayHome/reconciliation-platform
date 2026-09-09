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

  it('requires bank and GL, and makes both subledgers optional', () => {
    const required = sourceTabs.filter((tab) => isDroppable(tab) && !tab.optional).map((t) => t.id);
    expect(required).toEqual(['bank', 'gl']);
  });

  it('allows one GL workbook and up to four of each other droppable type', () => {
    const bounds = Object.fromEntries(
      sourceTabs.filter(isDroppable).map((tab) => [tab.id, [tab.min, tab.max]]),
    );
    expect(bounds).toEqual({ bank: [1, 4], gl: [1, 1], ap: [1, 4], ar: [1, 4] });
  });

  it('never lets AR reuse AP wording in its hint', () => {
    // The Phase 2 ruling permits AP and AR to share the BILLING source type and the filename
    // shape, but not the rule set -- and wording is the visible half of that.
    const ar = findSourceTab('ar');
    expect(ar?.kind === 'droppable' && ar.hint).not.toMatch(/\bAP\b/);
    expect(ar?.kind === 'droppable' && ar.sampleName).toContain('ar');
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

    it('reads "optional" rather than a zero count when an optional type is empty', () => {
      // A "0 of 4" on AR would imply the run is short of something it is not -- the same instinct
      // as the rail's badge rule (absent, not zero).
      expect(sourceTabMeta(tab('ar'), 0)).toBe('optional');
      expect(sourceTabMeta(tab('ap'), 0)).toBe('optional');
      expect(sourceTabMeta(tab('payroll'), 0)).toBe('optional');
    });

    it('switches an optional type to a count once it carries files', () => {
      expect(sourceTabMeta(tab('ar'), 1)).toBe('1 of 4 entities');
    });

    it('says a required type is required rather than showing zero', () => {
      expect(sourceTabMeta(tab('gl'), 0)).toBe('required');
    });
  });
});
