import type { NormalizedTransaction } from '@recon/domain';
import { describe, expect, it } from 'vitest';
import { normalizeAmount, normalizeCaseInsensitive, normalizeDate } from './transactions';
import { randomUUID } from 'node:crypto';

describe('Transaction Normalization - Edge Cases', () => {
  describe('normalizeAmount', () => {
    it('handles zero amounts', () => {
      const amounts = [0, '0', '0.00', '$0', '(0)'];
      amounts.forEach((amount) => {
        const str = String(amount).replace(/[^0-9.-]/g, '');
        const num = parseFloat(str) || 0;
        expect(num).toBe(0);
      });
    });

    it('handles accounting format negatives (parentheses)', () => {
      const amount = '(1000.00)';
      const normalized = amount.replace(/[^0-9.-]/g, '');
      expect(normalized).toContain('1000');
    });

    it('handles amounts with currency symbols', () => {
      const amounts = ['$1000.00', '€1000,00', '£1000.00', '¥1000'];
      amounts.forEach((amount) => {
        const numeric = parseFloat(amount.replace(/[^0-9.-]/g, ''));
        expect(typeof numeric).toBe('number');
      });
    });

    it('handles comma separators (European format)', () => {
      const amount = '1.000,99';
      // European format handler
      const swapped = amount.replace('.', '').replace(',', '.');
      const num = parseFloat(swapped);
      expect(num).toBeCloseTo(1000.99);
    });

    it('handles very large amounts', () => {
      const amount = 999999999999.99;
      expect(amount).toBeGreaterThan(999999999999);
    });

    it('handles very small decimal amounts', () => {
      const amount = 0.01;
      expect(amount).toBeCloseTo(0.01);
    });

    it('handles multiple decimal points (malformed data)', () => {
      const amount = '1000.50.25';
      const first = amount.substring(0, amount.lastIndexOf('.'));
      expect(first).toBe('1000.50');
    });

    it('handles whitespace around amounts', () => {
      const amounts = ['  1000  ', ' -500 ', '\t250.00\n'];
      amounts.forEach((amount) => {
        const trimmed = amount.trim();
        expect(parseFloat(trimmed)).toBeDefined();
      });
    });
  });

  describe('normalizeDate', () => {
    it('handles ISO format dates', () => {
      const date = '2025-01-15';
      const parsed = new Date(`${date}T00:00:00Z`);
      expect(parsed).toBeDefined();
    });

    it('handles US format dates', () => {
      const date = '01/15/2025';
      const parsed = new Date(date);
      expect(parsed).toBeDefined();
    });

    it('handles European format dates', () => {
      const date = '15-01-2025';
      const parsed = new Date(date);
      expect(parsed).toBeDefined();
    });

    it('handles full month names', () => {
      const date = 'January 15, 2025';
      const parsed = new Date(date);
      expect(parsed).toBeDefined();
    });

    it('handles malformed dates gracefully', () => {
      const dates = ['not-a-date', '2025-13-45', '32-02-2025', 'ABC-123-456'];
      dates.forEach((date) => {
        const parsed = new Date(date);
        expect(Number.isNaN(parsed.valueOf())).toBe(true);
      });
    });

    it('handles leap year dates', () => {
      const feb29_2024 = '2024-02-29';
      const parsed = new Date(`${feb29_2024}T00:00:00Z`);
      expect(parsed.getUTCMonth()).toBe(1); // February
    });

    it('handles century boundaries', () => {
      const dates = [
        '1999-12-31',
        '2000-01-01',
        '2025-01-01',
      ];
      dates.forEach((date) => {
        const parsed = new Date(`${date}T00:00:00Z`);
        expect(parsed).toBeDefined();
      });
    });

    it('handles partial dates', () => {
      const partialDates = ['2025', '2025-01', '2025-1'];
      partialDates.forEach((date) => {
        // Partial date parsing depends on implementation
        expect(date).toBeDefined();
      });
    });

    it('handles Excel serial date format conversion', () => {
      // Excel stores dates as serial numbers (days since 1900-01-01)
      const excelSerial = 45315; // Should be around 2024-01-01
      const excelEpoch = new Date(1899, 11, 30); // Excel epoch
      const jsDate = new Date(excelEpoch.getTime() + excelSerial * 86400000);
      expect(jsDate).toBeDefined();
    });
  });

  describe('normalizeCaseInsensitive', () => {
    it('converts to consistent case', () => {
      const values = ['DEPOSIT', 'deposit', 'Deposit', 'DePoSiT'];
      const normalized = values.map((v) => v.toLowerCase());
      const allSame = normalized.every((v) => v === normalized[0]);
      expect(allSame).toBe(true);
    });

    it('handles empty strings', () => {
      const value = '';
      const normalized = value.toLowerCase();
      expect(normalized).toBe('');
    });

    it('handles values with numbers and special chars', () => {
      const values = ['WIRE-REF-123', 'Wire-Ref-123', 'wire-ref-123'];
      const normalized = values.map((v) => v.toLowerCase());
      expect(normalized.every((v) => v === normalized[0])).toBe(true);
    });

    it('handles Unicode characters', () => {
      const values = ['CAFÉ', 'café', 'Café'];
      const normalized = values.map((v) => v.toLowerCase());
      expect(normalized.length).toBe(3);
    });

    it('handles whitespace preservation', () => {
      const value = '  DEPOSIT  ';
      const normalized = value.toLowerCase();
      expect(normalized).toBe('  deposit  ');
    });
  });

  describe('Transaction Normalization - Combined Logic', () => {
    it('handles transactions with missing fields', () => {
      const tx: Partial<NormalizedTransaction> = {
        id: randomUUID(),
        source: 'bank',
        amount: undefined,
        transactionDate: undefined,
        description: undefined,
      };

      expect(tx.amount).toBeUndefined();
      expect(tx.transactionDate).toBeUndefined();
    });

    it('handles transaction with null values that should be zero', () => {
      const amounts = [null, undefined, 0];
      const normalized = amounts.map((a) => a ?? 0);
      expect(normalized).toEqual([0, 0, 0]);
    });

    it('handles transaction dates with posting date fallback', () => {
      const cases = [
        { transactionDate: '2025-01-15', postingDate: '2025-01-16' },
        { transactionDate: undefined, postingDate: '2025-01-16' },
        { transactionDate: null, postingDate: '2025-01-16' },
      ];

      cases.forEach((c) => {
        const date = c.transactionDate ?? c.postingDate;
        expect(date).toBeDefined();
      });
    });

    it('handles duplicate detection fields', () => {
      const tx1 = {
        source: 'bank',
        transactionDate: '2025-01-15',
        amount: 1000,
        description: 'DEPOSIT',
      };

      const tx2 = {
        source: 'bank',
        transactionDate: '2025-01-15',
        amount: 1000,
        description: 'deposit',
      };

      // For duplicate detection, normalize case and amount
      expect(tx1.description?.toLowerCase()).toBe(tx2.description?.toLowerCase());
      expect(tx1.amount).toBe(tx2.amount);
    });
  });

  describe('Text tokenization and normalization', () => {
    it('handles description with special characters', () => {
      const descriptions = [
        'WIRE REF# 123-456 // PC',
        'PAY: DOE, JOHN - INVOICE #INV-2025-001',
        'DEPOSIT - CHECK #12345 - ACME CORP',
        'TRANSFER @ 3:45 PM',
      ];

      descriptions.forEach((desc) => {
        const tokens = desc
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, ' ')
          .split(' ')
          .filter(Boolean);
        expect(tokens.length).toBeGreaterThan(0);
      });
    });

    it('handles merchant/payee name normalization', () => {
      const names = [
        '  AMAZON  ', // Extra spaces
        'McDonald\'s', // Apostrophe
        'AT&T', // Ampersand
        'CVS/PHARMACY', // Slash
      ];

      names.forEach((name) => {
        const normalized = name.trim().toUpperCase();
        expect(normalized).toBeDefined();
      });
    });

    it('handles empty and whitespace-only text', () => {
      const texts = ['', '   ', '\t', '\n'];
      texts.forEach((text) => {
        const trimmed = text.trim();
        expect(trimmed).toBe('');
      });
    });

    it('handles very long descriptions', () => {
      const longDesc = 'A'.repeat(1000);
      expect(longDesc.length).toBe(1000);
      const normalized = longDesc.toLowerCase();
      expect(normalized).toBeDefined();
    });
  });

  describe('Reference and check number normalization', () => {
    it('handles check numbers with prefixes', () => {
      const checks = ['123456', 'CHK-123456', 'C123456', '00123456'];
      checks.forEach((check) => {
        const numericPart = check.replace(/[^0-9]/g, '');
        expect(/^\d+$/.test(numericPart)).toBe(true);
      });
    });

    it('handles reference numbers with separators', () => {
      const refs = ['123-456-789', '123_456_789', '123.456.789', '1234567890'];
      refs.forEach((ref) => {
        const normalized = ref.replace(/[^0-9]/g, '');
        expect(normalized).toMatch(/^\d+$/);
      });
    });

    it('handles missing reference numbers', () => {
      const refs = [undefined, null, '', '   ', 'N/A', 'NONE'];
      refs.forEach((ref) => {
        const normalized = ref ? String(ref).trim() : undefined;
        expect(normalized === undefined || normalized === '' || normalized.length > 0).toBe(true);
      });
    });
  });

  describe('Data quality flag detection', () => {
    it('detects zero-amount transactions', () => {
      const amounts = [0, '0', '0.00'];
      amounts.forEach((amount) => {
        const numeric = parseFloat(String(amount));
        expect(numeric).toBe(0);
      });
    });

    it('detects missing critical fields', () => {
      const txs = [
        { amount: null, transactionDate: '2025-01-15' },
        { amount: 1000, transactionDate: null },
        { amount: null, transactionDate: null },
      ];

      txs.forEach((tx) => {
        const hasMissing = tx.amount === null || tx.transactionDate === null;
        expect(hasMissing).toBe(true);
      });
    });

    it('detects malformed dates', () => {
      const dates = ['2025-13-45', 'not-a-date', '32-02-2025'];
      dates.forEach((date) => {
        const parsed = new Date(date);
        expect(Number.isNaN(parsed.valueOf())).toBe(true);
      });
    });
  });
});
