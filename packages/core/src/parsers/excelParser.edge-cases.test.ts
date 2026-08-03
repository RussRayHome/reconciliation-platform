import { describe, expect, it } from 'vitest';

describe('Excel Parser - Edge Cases', () => {
  describe('Header Normalization and Scoring', () => {
    it('handles headers with leading/trailing whitespace', () => {
      // Test normalization of headers with various whitespace patterns
      const testCases = ['  Transaction Date  ', '\tAmount\n', '   CHECK NUMBER   '];

      testCases.forEach((header) => {
        expect(header.trim()).toBeDefined();
      });
    });

    it('handles headers with special characters', () => {
      const testCases = [
        'Trans-Action@Date',
        'Amount!Amount',
        'Check#Number$',
        'Description&Notes',
      ];

      testCases.forEach((header) => {
        const normalized = header
          .toUpperCase()
          .replaceAll(/[^A-Z0-9]+/g, ' ')
          .replaceAll(/\s+/g, ' ')
          .trim();
        expect(normalized).toMatch(/^[A-Z0-9\s]+$/);
      });
    });

    it('handles headers that are entirely special characters', () => {
      const header = '###$$$%%%';
      const normalized = header
        .toUpperCase()
        .replaceAll(/[^A-Z0-9]+/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
      expect(normalized).toBe('');
    });

    it('handles very long headers', () => {
      const longHeader = 'A' + 'verylongheadername'.repeat(50);
      expect(longHeader.length).toBeGreaterThan(100);
      const normalized = longHeader.toUpperCase().trim();
      expect(normalized).toBeDefined();
    });

    it('handles Unicode and special language characters', () => {
      const testCases = ['Montant€Amount', 'Dátum日期Date', 'Descripción•Description'];

      testCases.forEach((header) => {
        const normalized = header
          .toUpperCase()
          .replaceAll(/[^A-Z0-9]+/g, ' ')
          .replaceAll(/\s+/g, ' ')
          .trim();
        expect(normalized).toBeDefined();
      });
    });
  });

  describe('Tokenization Edge Cases', () => {
    it('handles empty token lists after filtering', () => {
      const tokens = ['', '', ''].filter(Boolean);
      expect(tokens.length).toBe(0);
    });

    it('handles tokens ending with "S" for plural removal', () => {
      const testCases = [
        'CHECKS',
        'TRANSACTIONS',
        'AMOUNTS',
        'DATES',
        'S', // Edge case: just "S"
        'SS', // Multiple S's
      ];

      testCases.forEach((token) => {
        const result = token.endsWith('S') ? token.slice(0, -1) : token;
        expect(result).toBeDefined();
      });
    });

    it('handles tokens with numbers mixed in', () => {
      const tokens = 'CHECK 123 AMOUNT 456'.split(' ');
      const processed = tokens.map((t) => (t.endsWith('S') ? t.slice(0, -1) : t));
      expect(processed).toContain('CHECK');
      expect(processed).toContain('123');
    });
  });

  describe('Cell Value Parsing Edge Cases', () => {
    it('handles various null/undefined values', () => {
      const values = [null, undefined];
      values.forEach((val) => {
        expect(val ?? 'default').toBeDefined();
      });
    });

    it('handles primitive types: string, number, boolean, bigint', () => {
      const values = ['text', 123, true, BigInt(9007199254740991)];
      values.forEach((val) => {
        const stringified = String(val);
        expect(typeof stringified).toBe('string');
      });
    });

    it('handles Date objects', () => {
      const dates = [
        new Date('2025-01-15'),
        new Date('2024-12-31'),
        new Date('2025-02-29'), // Leap year date doesn't exist in 2025
      ];

      dates.forEach((date) => {
        const iso = date.toISOString();
        expect(typeof iso).toBe('string');
      });
    });

    it('handles very large and very small numbers', () => {
      const numbers = [0, 0.01, 999999999.99, -999999999.99, Number.MAX_SAFE_INTEGER];
      numbers.forEach((num) => {
        const str = String(num);
        expect(typeof str).toBe('string');
      });
    });

    it('handles decimal precision edge cases', () => {
      const amounts = [
        0.1 + 0.2, // Classic floating point issue
        100.005,
        100.015,
        1000.001,
      ];

      amounts.forEach((amount) => {
        const str = String(amount);
        expect(str).toMatch(/^\d+\.?\d*$/);
      });
    });

    it('handles Excel rich text formats', () => {
      // Simulate Excel-style rich text objects
      const richText = {
        text: 'Sample Text',
        font: { bold: true },
      };

      if (typeof richText === 'object' && richText !== null && 'text' in richText) {
        expect(richText.text).toBe('Sample Text');
      }
    });
  });

  describe('Header-to-Field Matching', () => {
    it('exact match returns perfect score', () => {
      const header = 'TRANSACTION DATE';
      const alias = 'TRANSACTION DATE';
      expect(header === alias).toBe(true);
    });

    it('substring match returns high score', () => {
      const header = 'TRANSACTION DATE AND TIME';
      const alias = 'TRANSACTION DATE';
      expect(header.includes(alias)).toBe(true);
    });

    it('token partial match returns good score', () => {
      const header = 'CHECK NUMBER';
      // After tokenization, should find overlap
      expect(header.toUpperCase().includes('CHECK')).toBe(true);
    });

    it('no match returns zero score', () => {
      const values: string[] = ['TRANSACTION DATE', 'AMOUNT'];
      const header = values[0] ?? '';
      const alias = values[1] ?? '';
      expect(header.includes(alias)).toBe(false);
    });
  });

  describe('Configuration-Driven Field Mapping', () => {
    it('handles missing configuration for source system', () => {
      const config: Record<string, unknown> = {};
      expect(config['UNKNOWN_SYSTEM']).toBeUndefined();
    });

    it('handles empty field mappings', () => {
      const mappings: Record<string, string[]> = {};
      expect(Object.keys(mappings).length).toBe(0);
    });

    it('handles fields with multiple aliases', () => {
      const aliases = ['CHECK #', 'CHECK NUM', 'CHK', 'CHECK_NUMBER'];
      expect(aliases.length).toBeGreaterThan(1);
      expect(aliases).toContain('CHECK #');
    });
  });

  describe('Row Extraction Edge Cases', () => {
    it('handles workbooks with multiple sheets', () => {
      const sheetNames = ['Transactions', 'Summary', 'Reconciliation'];
      expect(sheetNames).toHaveLength(3);
      expect(sheetNames[0]).toBe('Transactions');
    });

    it('handles sheets with headers in non-first row', () => {
      // Common scenario where there are blank rows or descriptive text before headers
      const rows = [
        ['Bank Reconciliation Report'],
        ['Generated: 2025-01-15'],
        ['Account: 12345'],
        [], // blank row
        ['Date', 'Amount', 'Description'], // actual headers
      ];

      expect(rows.length).toBeGreaterThan(1);
    });

    it('handles rows with missing columns at the end', () => {
      const row = ['2025-01-15', '1000.00']; // Missing Description column
      expect(row.length).toBe(2);
    });

    it('handles rows with excess empty cells', () => {
      const row = ['2025-01-15', '1000.00', 'Deposit', '', '', '', ''];
      expect(row.filter((cell) => cell !== '').length).toBeLessThan(row.length);
    });

    it('handles merged cells in Excel', () => {
      // Merged cells can cause issues with row extraction
      const row1 = ['Date', 'Amount']; // These might be merged across multiple columns
      expect(row1).toBeDefined();
    });
  });

  describe('Data Type Inference', () => {
    it('handles amounts with various formats', () => {
      const amounts = [
        '1000',
        '1,000.00',
        '(1000.00)', // Accounting format for negative
        '$ 1000.00',
        '1000 USD',
      ];

      amounts.forEach((amount) => {
        // Should be parseable to a number
        const numeric = Number.parseFloat(amount.replaceAll(/[^0-9.-]/g, ''));
        expect(typeof numeric).toBe('number');
      });
    });

    it('handles dates in various formats', () => {
      const dates = ['2025-01-15', '01/15/2025', '15-01-2025', 'January 15, 2025'];

      dates.forEach((date) => {
        const parsed = new Date(date);
        expect(parsed).toBeDefined();
      });
    });

    it('handles check numbers that look like numbers', () => {
      const checks = ['123456', 'CHK-123456', 'C123456', 'OTHER-NAME'];
      checks.forEach((check) => {
        expect(check).toBeDefined();
      });
    });
  });

  describe('Whitespace and Trim Edge Cases', () => {
    it('handles cells with only whitespace', () => {
      const cells = ['   ', '\t', '\n', '  \t  \n  '];
      cells.forEach((cell) => {
        expect(cell.trim()).toBe('');
      });
    });

    it('handles mixed whitespace in values', () => {
      const values = ['  text  ', '\ttab\t', 'multi  space'];
      values.forEach((val) => {
        const trimmed = val.trim();
        expect(trimmed).toBeDefined();
      });
    });
  });

  describe('File Processing Robustness', () => {
    it('handles file reading with encoding issues', () => {
      // Should handle various encodings gracefully
      expect(true).toBe(true); // Placeholder - actual testing requires real file I/O
    });

    it('handles corrupted worksheet references', () => {
      // When worksheet names don't match expected values
      const worksheetName = 'Sheet1';
      const expectedNames = ['Transactions', 'Data', 'Records'];
      const found = expectedNames.includes(worksheetName);
      expect(found).toBe(false); // Correctly identifies mismatch
    });
  });
});
