import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDismissableDetails } from './useDismissableDetails';

// R3 X6: <details> stays open until its own summary is clicked again, so a run-bar popover would
// sit over the page while the user clicked elsewhere.
function Harness() {
  const ref = useDismissableDetails();
  return (
    <div>
      <button type="button">outside</button>
      <details className="popover" ref={ref} open>
        <summary>Run info</summary>
        <p>menu contents</p>
      </details>
    </div>
  );
}

const popover = (): HTMLDetailsElement => document.querySelector('.popover') as HTMLDetailsElement;

describe('useDismissableDetails', () => {
  // This project does not enable RTL auto-cleanup (App.test.tsx imports cleanup explicitly), so
  // without this each render leaks into the next test's document.querySelector.
  afterEach(cleanup);

  it('closes on an outside pointer press', () => {
    render(<Harness />);
    expect(popover().open).toBe(true);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));

    expect(popover().open).toBe(false);
  });

  it('closes on Escape', () => {
    render(<Harness />);
    expect(popover().open).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(popover().open).toBe(false);
  });

  it('leaves it open when the press is inside — the summary is the browser own toggle', () => {
    render(<Harness />);

    fireEvent.pointerDown(screen.getByText('menu contents'));

    expect(popover().open).toBe(true);
  });
});
