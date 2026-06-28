// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { SectionCard, StatCard } from '@recon/ui';

describe('UI card primitives', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders SectionCard optional description and actions when provided', () => {
    render(
      <SectionCard
        title="Reconciliation Overview"
        description="Track current reconciliation activity"
        actions={<button type="button">Refresh</button>}
      >
        <p>Body content</p>
      </SectionCard>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Reconciliation Overview' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Track current reconciliation activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('omits SectionCard optional regions when description and actions are not provided', () => {
    const { container } = render(
      <SectionCard title="Exceptions">
        <p>Exceptions body</p>
      </SectionCard>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Exceptions' })).toBeInTheDocument();
    expect(container.querySelector('.section-card__actions')).toBeNull();
    expect(container.querySelector('.section-card__header p')).toBeNull();
  });

  it('renders StatCard with default tone and without optional helper/icon content', () => {
    const { container } = render(<StatCard label="Exact matches" value={42} />);

    expect(screen.getByText('Exact matches')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(container.querySelector('.stat-card--default')).not.toBeNull();
    expect(container.querySelector('.stat-card__icon-shell')).toBeNull();
    expect(container.querySelector('.stat-card__helper')).toBeNull();
  });

  it('renders StatCard icon shell and helper text when optional props are provided', () => {
    const { container } = render(
      <StatCard
        label="Unresolved exposure"
        value="$125.00"
        tone="warning"
        helper="Needs reviewer follow-up"
        icon={<svg aria-label="warning icon" viewBox="0 0 10 10" />}
        iconLabel="Warning status"
      />,
    );

    expect(screen.getByText('Unresolved exposure')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText('Needs reviewer follow-up')).toBeInTheDocument();
    expect(container.querySelector('.stat-card--warning')).not.toBeNull();

    const iconShell = container.querySelector('.stat-card__icon-shell');
    expect(iconShell).not.toBeNull();
    expect(iconShell?.getAttribute('title')).toBe('Warning status');
  });
});
