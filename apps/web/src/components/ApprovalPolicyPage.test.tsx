// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ApprovalPolicyPage } from './ApprovalPolicyPage';

afterEach(() => {
  cleanup();
});

describe('ApprovalPolicyPage', () => {
  it('renders the header and all four placeholder panels', () => {
    render(<ApprovalPolicyPage />);

    expect(screen.getByText('Approval policy')).toBeTruthy();
    expect(screen.getByText(/Visible to admins only\.$/)).toBeTruthy();

    const titles = ['Per-type rules', 'Approvers & quorum', 'Delegation limits', 'Default versions'];
    for (const title of titles) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });
});
