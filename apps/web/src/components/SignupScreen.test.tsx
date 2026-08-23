// @vitest-environment jsdom

import type * as ApiModule from '../lib/api';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { SignupScreen } from './SignupScreen';
import type { AuthenticatedUserSession } from '../lib/authSession';

afterEach(() => {
  cleanup();
});

const mockedApi = vi.hoisted(() => ({
  entityVerificationCheckRequest: vi.fn<typeof ApiModule.entityVerificationCheckRequest>(),
  signupRequest: vi.fn<typeof ApiModule.signupRequest>(),
  identityConfirmRequest: vi.fn<typeof ApiModule.identityConfirmRequest>(),
  identityResendRequest: vi.fn<typeof ApiModule.identityResendRequest>(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    entityVerificationCheckRequest: mockedApi.entityVerificationCheckRequest,
    signupRequest: mockedApi.signupRequest,
    identityConfirmRequest: mockedApi.identityConfirmRequest,
    identityResendRequest: mockedApi.identityResendRequest,
  };
});

const SIGNUP_RESULT = {
  token: 'token-1',
  username: 'j.analyst',
  role: 'senior-analyst' as const,
  organizationId: 'org-1',
  firstName: 'Jane',
  lastName: 'Analyst',
};

const renderScreen = () => {
  const onAuthenticated = vi.fn<(session: AuthenticatedUserSession) => void>();
  render(
    <MemoryRouter>
      <SignupScreen onAuthenticated={onAuthenticated} />
    </MemoryRouter>,
  );
  return { onAuthenticated };
};

const fillCredentials = () => {
  fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: 'analyst@example.com' } });
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Analyst' } });
  fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'j.analyst' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Str0ng!Passw0rd' } });
};

const fillCompany = () => {
  fireEvent.change(screen.getByLabelText(/legal entity name/i), { target: { value: 'Example Co' } });
  fireEvent.change(screen.getByLabelText(/headcount/i), { target: { value: '51-250' } });
  fireEvent.change(screen.getByLabelText(/industry/i), { target: { value: 'saas' } });
};

const fillEntity = () => {
  fireEvent.change(screen.getByLabelText(/state of record/i), { target: { value: 'Delaware' } });
  fireEvent.change(screen.getByLabelText(/filing \/ registration number/i), {
    target: { value: '1234567' },
  });
};

const acceptTerms = () => {
  fireEvent.click(screen.getByRole('button', { name: /accept the terms of service/i }));
};

const fillValidForm = () => {
  fillCredentials();
  fillCompany();
  fillEntity();
  acceptTerms();
};

// A submit-button click runs the browser's native constraint validation first -- an invalid
// `type="email"` value blocks the 'submit' event (and our own handler) before React ever sees it,
// the same way it would in a real browser. Dispatching 'submit' directly on the form bypasses that
// native step, exercising the app's own validation logic the way the other field types already do.
const submitForm = () => {
  const form = screen.getByRole('button', { name: /create account and start trial/i }).closest('form');
  fireEvent.submit(form as HTMLFormElement);
};

const sosPanel = () =>
  screen.getByText(/entity verification — secretary of state/i).closest('.signup-panel') as HTMLElement;

beforeEach(() => {
  mockedApi.entityVerificationCheckRequest.mockReset();
  mockedApi.signupRequest.mockReset();
  mockedApi.identityConfirmRequest.mockReset();
  mockedApi.identityResendRequest.mockReset();
  mockedApi.signupRequest.mockResolvedValue(SIGNUP_RESULT);
  mockedApi.identityConfirmRequest.mockResolvedValue(undefined);
  mockedApi.identityResendRequest.mockResolvedValue(undefined);
});

describe('field validation notes', () => {
  it('shows nothing for an empty email, an error for an invalid one, and ok for a valid one', () => {
    renderScreen();
    const email = screen.getByLabelText(/work email/i);

    fireEvent.change(email, { target: { value: 'not-an-email' } });
    expect(screen.getByText('Enter a valid work email address.')).toBeTruthy();

    fireEvent.change(email, { target: { value: 'analyst@example.com' } });
    expect(screen.getByText('Looks good.')).toBeTruthy();

    fireEvent.change(email, { target: { value: '' } });
    expect(screen.queryByText('Looks good.')).toBeNull();
  });

  it('flags a username that looks like an email, one that is too short, and accepts a valid one', () => {
    renderScreen();
    const username = screen.getByLabelText(/^username$/i);

    fireEvent.change(username, { target: { value: 'someone@example.com' } });
    expect(screen.getByText('Username cannot be an email address.')).toBeTruthy();

    fireEvent.change(username, { target: { value: 'abc' } });
    expect(screen.getByText('Username must be at least 4 characters.')).toBeTruthy();

    fireEvent.change(username, { target: { value: 'j.analyst' } });
    expect(screen.getByText('Available format.')).toBeTruthy();
  });

  it('leaves the phone note blank when optional and empty, but requires it once SMS is selected', () => {
    renderScreen();
    expect(screen.queryByText(/mobile number is required/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /text message to phone/i }));
    expect(screen.getByText('A mobile number is required to verify by text.')).toBeTruthy();
  });

  it('accepts an 11-digit number starting with 1, rejects a short one, and formats a valid 10-digit one', () => {
    renderScreen();
    const phone = screen.getByLabelText(/mobile phone/i);

    fireEvent.change(phone, { target: { value: '5551234' } });
    expect(screen.getByText('Enter a full US mobile number, 10 digits.')).toBeTruthy();

    fireEvent.change(phone, { target: { value: '15555550123' } });
    expect(screen.getByText('We can text a code to •••• 0123.')).toBeTruthy();

    fireEvent.change(phone, { target: { value: '5555550199' } });
    expect(screen.getByText('We can text a code to •••• 0199.')).toBeTruthy();
  });

  it('reflects password rule progress as the value changes', () => {
    renderScreen();
    const password = screen.getByLabelText(/^password$/i);

    fireEvent.change(password, { target: { value: 'weak' } });
    expect(screen.getByText('At least 10 characters').closest('span')).not.toHaveClass(
      'signup-pw-rule--met',
    );

    fireEvent.change(password, { target: { value: 'Str0ng!Passw0rd' } });
    expect(screen.getByText('At least 10 characters').closest('span')).toHaveClass('signup-pw-rule--met');
    expect(screen.getByText('One symbol (!@#$…)').closest('span')).toHaveClass('signup-pw-rule--met');
  });
});

describe('Secretary of State entity verification', () => {
  it('blocks the check when the legal entity name is missing', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));
    expect(screen.getByText('Enter the legal entity name above before verifying.')).toBeTruthy();
  });

  it('blocks the check when the entity state is missing', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/legal entity name/i), { target: { value: 'Example Co' } });
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));
    expect(screen.getByText('Select the state where the entity is on record.')).toBeTruthy();
  });

  it('blocks the check when the filing number is too short', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/legal entity name/i), { target: { value: 'Example Co' } });
    fireEvent.change(screen.getByLabelText(/state of record/i), { target: { value: 'Delaware' } });
    fireEvent.change(screen.getByLabelText(/filing \/ registration number/i), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));
    expect(
      screen.getByText('Enter the filing or registration number issued by the Secretary of State.'),
    ).toBeTruthy();
  });

  it('shows the verified badge and details, falling back to the typed company name when unset', async () => {
    mockedApi.entityVerificationCheckRequest.mockResolvedValue({ status: 'verified' });
    renderScreen();
    fillCompany();
    fillEntity();
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));

    expect(await within(sosPanel()).findByText('Verified')).toBeTruthy();
    expect(within(sosPanel()).getByText('Example Co')).toBeTruthy();
    expect(within(sosPanel()).getByText('active')).toBeTruthy();
  });

  it('shows the registered name and standing when the server returns them', async () => {
    mockedApi.entityVerificationCheckRequest.mockResolvedValue({
      status: 'verified',
      registeredName: 'Example Co LLC',
      standing: 'good standing',
    });
    renderScreen();
    fillCompany();
    fillEntity();
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));

    expect(await screen.findByText('Example Co LLC')).toBeTruthy();
    expect(screen.getByText('good standing')).toBeTruthy();
  });

  it('shows the not-found state when the server reports failed', async () => {
    mockedApi.entityVerificationCheckRequest.mockResolvedValue({ status: 'failed' });
    renderScreen();
    fillCompany();
    fillEntity();
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));

    expect(await within(sosPanel()).findByText('Not found')).toBeTruthy();
    expect(screen.getByText(/no active record matched that filing number/i)).toBeTruthy();
  });

  it('falls back to an incomplete state when the check request itself fails', async () => {
    mockedApi.entityVerificationCheckRequest.mockRejectedValue(new Error('network down'));
    renderScreen();
    fillCompany();
    fillEntity();
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));

    expect(
      await screen.findByText('The Secretary of State check could not run. You can still create your account.'),
    ).toBeTruthy();
  });

  it('resets to idle once the company name changes again after a check', async () => {
    mockedApi.entityVerificationCheckRequest.mockResolvedValue({ status: 'verified' });
    renderScreen();
    fillCompany();
    fillEntity();
    fireEvent.click(screen.getByRole('button', { name: /verify with secretary of state/i }));
    expect(await within(sosPanel()).findByText('Verified')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/legal entity name/i), { target: { value: 'Example Co 2' } });
    expect(within(sosPanel()).getByText('Not yet checked')).toBeTruthy();
  });

  it('selects the foreign entity type option', () => {
    renderScreen();
    const foreign = screen.getByRole('button', { name: /foreign entity/i });
    fireEvent.click(foreign);
    expect(foreign).toHaveClass('signup-choice--active');
  });
});

describe('form submission validation', () => {
  it('lists every outstanding problem when submitting an empty form', () => {
    renderScreen();
    submitForm();

    expect(screen.getByText(/account could not be created/i)).toBeTruthy();
    expect(screen.getByText('Work email is required.')).toBeTruthy();
    expect(screen.getByText('Full name is required for audit records.')).toBeTruthy();
    expect(screen.getByText('Choose a username.')).toBeTruthy();
    expect(screen.getByText('Password does not meet all five requirements.')).toBeTruthy();
    expect(screen.getByText('Legal entity name is required.')).toBeTruthy();
    expect(screen.getByText('Select a headcount range.')).toBeTruthy();
    expect(screen.getByText('Select an industry.')).toBeTruthy();
    expect(screen.getByText('Select the state where the entity is on record.')).toBeTruthy();
    expect(screen.getByText('Enter the Secretary of State filing number.')).toBeTruthy();
    expect(
      screen.getByText('Accept the Terms of Service and Data Processing Addendum.'),
    ).toBeTruthy();
    expect(mockedApi.signupRequest).not.toHaveBeenCalled();
  });

  it('reports the singular item-needs-attention phrasing when exactly one problem remains', () => {
    renderScreen();
    fillCredentials();
    fillCompany();
    fillEntity();
    submitForm();

    expect(screen.getByText(/1 item needs attention/i)).toBeTruthy();
  });

  it('surfaces an invalid-email problem distinct from the required-email problem', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: 'not-an-email' } });
    submitForm();
    expect(within(screen.getByRole('list')).getByText('Enter a valid work email address.')).toBeTruthy();
  });

  it('surfaces an invalid-username problem distinct from the required-username problem', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'abc' } });
    submitForm();
    expect(within(screen.getByRole('list')).getByText('Username must be at least 4 characters.')).toBeTruthy();
  });

  it('surfaces the phone problem when SMS is selected with an invalid number', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /text message to phone/i }));
    fireEvent.change(screen.getByLabelText(/mobile phone/i), { target: { value: '123' } });
    submitForm();
    expect(
      within(screen.getByRole('list')).getByText('Enter a full US mobile number, 10 digits.'),
    ).toBeTruthy();
  });

  it('submits successfully once every field is valid, opening the verify-email modal', async () => {
    renderScreen();
    fillValidForm();
    submitForm();

    await waitFor(() => expect(mockedApi.signupRequest).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Verify your email')).toBeTruthy();
  });

  it('opens the confirm-phone modal copy when the SMS channel was chosen', async () => {
    renderScreen();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /text message to phone/i }));
    fireEvent.change(screen.getByLabelText(/mobile phone/i), { target: { value: '5555550123' } });
    submitForm();

    expect(await screen.findByText('Confirm your phone number')).toBeTruthy();
  });

  it('shows the server error message when signup rejects with an Error', async () => {
    mockedApi.signupRequest.mockRejectedValue(new Error('Username already taken.'));
    renderScreen();
    fillValidForm();
    submitForm();

    expect(await screen.findByText('Username already taken.')).toBeTruthy();
  });

  it('shows a generic error message when signup rejects with a non-Error value', async () => {
    mockedApi.signupRequest.mockRejectedValue('boom');
    renderScreen();
    fillValidForm();
    submitForm();

    expect(await screen.findByText('Signup failed. Try again.')).toBeTruthy();
  });

  it('ignores a second submit while the first request is still in flight', async () => {
    let resolveSignup: ((value: typeof SIGNUP_RESULT) => void) | undefined;
    mockedApi.signupRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignup = resolve;
        }),
    );
    renderScreen();
    fillValidForm();
    const form = screen.getByRole('button', { name: /create account and start trial/i }).closest('form');
    expect(form).toBeTruthy();

    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    expect(mockedApi.signupRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignup?.(SIGNUP_RESULT);
      await Promise.resolve();
    });
  });
});

describe('post-submit verification modal', () => {
  const submitAndOpenModal = async () => {
    renderScreen();
    fillValidForm();
    submitForm();
    await screen.findByText('Verify your email');
  };

  it('requires all six digits before confirming', async () => {
    await submitAndOpenModal();
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.slice(0, 5).forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String(index + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));
    expect(screen.getByText('Enter all six digits.')).toBeTruthy();
  });

  it('confirms the code and goes straight to done when MFA is off', async () => {
    await submitAndOpenModal();
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => expect(mockedApi.identityConfirmRequest).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('Account created')).toBeTruthy();
  });

  it('confirms the code and moves to the authenticator step when MFA is on', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /add an authenticator app/i }));
    fillValidForm();
    submitForm();
    await screen.findByText('Verify your email');

    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    expect(await screen.findByText('Pair your authenticator app')).toBeTruthy();
  });

  it('shows the server error message when confirm rejects with an Error', async () => {
    mockedApi.identityConfirmRequest.mockRejectedValue(new Error('Code expired.'));
    await submitAndOpenModal();
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    expect(await screen.findByText('Code expired.')).toBeTruthy();
  });

  it('shows a generic error message when confirm rejects with a non-Error value', async () => {
    mockedApi.identityConfirmRequest.mockRejectedValue('boom');
    await submitAndOpenModal();
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

    expect(await screen.findByText('That code is invalid or has expired.')).toBeTruthy();
  });

  it('resends the code and clears any prior modal error', async () => {
    await submitAndOpenModal();
    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));
    await waitFor(() => expect(mockedApi.identityResendRequest).toHaveBeenCalledTimes(1));
  });

  it('shows the server error message when resend rejects with an Error', async () => {
    mockedApi.identityResendRequest.mockRejectedValue(new Error('Too many requests.'));
    await submitAndOpenModal();
    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));
    expect(await screen.findByText('Too many requests.')).toBeTruthy();
  });

  it('shows a generic error message when resend rejects with a non-Error value', async () => {
    mockedApi.identityResendRequest.mockRejectedValue('boom');
    await submitAndOpenModal();
    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));
    expect(await screen.findByText('Could not resend the code.')).toBeTruthy();
  });

  it('lets the user skip the modal via the close button, still entering the app', async () => {
    const { onAuthenticated } = renderScreen();
    fillValidForm();
    submitForm();
    await screen.findByText('Verify your email');

    fireEvent.click(screen.getByRole('button', { name: /skip and enter the app/i }));
    await waitFor(() => expect(screen.queryByText('Verify your email')).toBeNull());
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('requires all six otp digits before pairing', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /add an authenticator app/i }));
    fillValidForm();
    submitForm();
    await screen.findByText('Verify your email');
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));
    await screen.findByText('Pair your authenticator app');

    fireEvent.click(screen.getByRole('button', { name: /pair and finish/i }));
    expect(screen.getByText('Enter the six-digit code from your authenticator app.')).toBeTruthy();
  });

  it('pairs the authenticator and reaches the done step', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /add an authenticator app/i }));
    fillValidForm();
    submitForm();
    await screen.findByText('Verify your email');
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));
    await screen.findByText('Pair your authenticator app');

    const otpInput = screen.getByPlaceholderText('000000');
    fireEvent.change(otpInput, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /pair and finish/i }));

    expect(await screen.findByText('Account created')).toBeTruthy();
  });

  it('finishes and enters the app from the done step', async () => {
    const onAuthenticated = vi.fn<(session: AuthenticatedUserSession) => void>();
    render(
      <MemoryRouter>
        <SignupScreen onAuthenticated={onAuthenticated} />
      </MemoryRouter>,
    );
    fillValidForm();
    submitForm();
    await screen.findByText('Verify your email');
    const cells = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxLength') === '1');
    cells.forEach((cell, index) => {
      fireEvent.change(cell, { target: { value: String((index + 1) % 10) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }));
    await screen.findByText('Account created');

    fireEvent.click(screen.getByRole('button', { name: /go to workspace/i }));
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });
});

describe('plan, MFA, and terms controls', () => {
  it('toggles MFA on and reflects the on-state copy', () => {
    renderScreen();
    const toggle = screen.getByRole('button', { name: /add an authenticator app/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(/after confirming your code you will pair an authenticator app/i),
    ).toBeTruthy();
  });

  it('selects a different plan and updates the order summary', () => {
    renderScreen();
    const enterpriseButton = screen.getByRole('button', { name: /enterprise/i });
    fireEvent.click(enterpriseButton);
    expect(enterpriseButton).toHaveClass('signup-plan--active');
    expect(screen.getByText('Custom')).toBeTruthy();
  });

  it('toggles terms acceptance on and off', () => {
    renderScreen();
    const terms = screen.getByRole('button', { name: /accept the terms of service/i });
    fireEvent.click(terms);
    expect(terms.querySelector('.signup-terms__box')).toHaveClass('signup-terms__box--checked');

    fireEvent.click(terms);
    expect(terms.querySelector('.signup-terms__box')).not.toHaveClass('signup-terms__box--checked');
  });
});

describe('human verification timer', () => {
  it('flips from checking to verified after the timeout', async () => {
    vi.useFakeTimers();
    try {
      renderScreen();
      expect(screen.getByText('Verifying you are human…')).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(1400);
        await Promise.resolve();
      });

      expect(screen.getByText('Verified — you are human')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
