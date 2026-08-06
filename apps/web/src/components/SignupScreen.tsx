import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { AuthenticatedUserSession } from '../App';
import { identityConfirmRequest, signupRequest, type SignupPayload, type SignupRole } from '../lib/api';
import { routePaths } from '../routes/routePaths';

const SIGNUP_ROLES: ReadonlyArray<{ value: SignupRole; label: string }> = [
  { value: 'financial-analyst', label: 'Financial Analyst' },
  { value: 'senior-analyst', label: 'Senior Analyst' },
  { value: 'staff-accountant', label: 'Staff Accountant' },
  { value: 'controller', label: 'Controller' },
  { value: 'vp-finance', label: 'VP Finance' },
  { value: 'cfo', label: 'CFO' },
];

const ENTITY_TYPES: ReadonlyArray<{ value: SignupPayload['entityType']; label: string }> = [
  { value: 'domestic', label: 'Domestic (formed in this state)' },
  { value: 'foreign', label: 'Foreign (registered to transact here)' },
];

const emptySignupForm: SignupPayload = {
  email: '',
  fullName: '',
  username: '',
  password: '',
  phone: '',
  companyName: '',
  headcount: '',
  industry: '',
  role: 'financial-analyst',
  fiscalYearEnd: '',
  entityState: '',
  entityFilingNumber: '',
  entityType: 'domestic',
  verificationChannel: 'email',
};

/**
 * Plain, functional signup form -- not a redesign matching the polished HTML mockup, just enough
 * to exercise the real backend end-to-end. Reuses the pre-auth `login-*` classnames LoginShell
 * already relies on rather than introducing a second stylesheet for this one screen.
 *
 * Account creation does not wait on entity or identity verification (see
 * entityVerificationService.ts / identityVerificationService.ts) -- `signupRequest` returns a
 * valid token immediately, so `onAuthenticated` fires whether or not the user confirms their code
 * right away. Only creating a mapping is gated on both resolving to 'verified'; the confirmation
 * step below is a convenience, not a hard block on entering the app.
 */
export function SignupScreen({
  onAuthenticated,
}: Readonly<{
  onAuthenticated: (session: AuthenticatedUserSession) => void;
}>) {
  const [form, setForm] = useState<SignupPayload>(emptySignupForm);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [session, setSession] = useState<AuthenticatedUserSession | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const setField =
    (field: keyof SignupPayload) =>
    (event: { target: { value: string } }): void => {
      setForm((previous) => ({ ...previous, [field]: event.target.value }));
    };

  const handleSubmit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    void signupRequest(form)
      .then((result) => {
        setSession({
          username: result.username,
          role: result.role,
          organizationId: result.organizationId,
          firstName: result.firstName,
          lastName: result.lastName,
          identityVerificationStatus: 'pending',
          entityVerificationStatus: 'pending',
          isFullyVerified: false,
        });
      })
      .catch((submitError: unknown) => {
        setError(submitError instanceof Error ? submitError.message : 'Signup failed. Try again.');
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleConfirmCode = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    if (isConfirming || !session) {
      return;
    }

    setIsConfirming(true);
    setCodeError(null);

    void identityConfirmRequest(code)
      .then(() => {
        onAuthenticated({ ...session, identityVerificationStatus: 'verified' });
      })
      .catch((confirmError: unknown) => {
        setCodeError(
          confirmError instanceof Error
            ? confirmError.message
            : 'That code is invalid or has expired.',
        );
      })
      .finally(() => {
        setIsConfirming(false);
      });
  };

  if (session) {
    return (
      <div className="login-page">
        <div className="login-wrap">
          <form
            className="login-card"
            aria-label="Confirm your identity"
            onSubmit={handleConfirmCode}
          >
            <h1>Check your {form.verificationChannel === 'sms' ? 'phone' : 'email'}</h1>
            <p>
              Enter the six-digit code we sent to confirm it&apos;s you. You can also continue now
              and confirm later -- only creating a mapping requires this to be complete.
            </p>

            <div className="login-field">
              <label htmlFor="signup-code">Verification code</label>
              <input
                id="signup-code"
                name="code"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </div>

            <button type="submit" className="login-btn-primary" disabled={isConfirming}>
              {isConfirming ? 'Confirming...' : 'Confirm and continue'}
            </button>

            {codeError ? (
              <p className="login-error" role="alert">
                <span className="login-error__mark" aria-hidden="true">
                  !
                </span>
                {codeError}
              </p>
            ) : null}

            <div className="login-divider">
              <span className="login-divider__line" />
              <span className="login-divider__text">or</span>
              <span className="login-divider__line" />
            </div>

            <button
              type="button"
              className="login-btn-secondary"
              onClick={() => onAuthenticated(session)}
            >
              Skip for now
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-wrap">
        <form className="login-card" aria-label="Create an account" onSubmit={handleSubmit}>
          <h1>Create an account</h1>

          <div className="login-field">
            <label htmlFor="signup-email">Work email</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={setField('email')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-fullName">Full name</label>
            <input
              id="signup-fullName"
              name="fullName"
              autoComplete="name"
              value={form.fullName}
              onChange={setField('fullName')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-username">Username</label>
            <input
              id="signup-username"
              name="username"
              autoComplete="username"
              value={form.username}
              onChange={setField('username')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={setField('password')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-phone">Mobile phone</label>
            <input
              id="signup-phone"
              name="phone"
              autoComplete="tel"
              placeholder="+1 (555) 014-2288"
              value={form.phone}
              onChange={setField('phone')}
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-verificationChannel">Verify by</label>
            <select
              id="signup-verificationChannel"
              name="verificationChannel"
              value={form.verificationChannel}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  verificationChannel: event.target.value as SignupPayload['verificationChannel'],
                }))
              }
            >
              <option value="email">Work email</option>
              <option value="sms">Text message</option>
            </select>
          </div>

          <div className="login-field">
            <label htmlFor="signup-companyName">Legal entity name</label>
            <input
              id="signup-companyName"
              name="companyName"
              value={form.companyName}
              onChange={setField('companyName')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-headcount">Headcount</label>
            <input
              id="signup-headcount"
              name="headcount"
              placeholder="e.g. 51-250"
              value={form.headcount}
              onChange={setField('headcount')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-industry">Industry</label>
            <input
              id="signup-industry"
              name="industry"
              value={form.industry}
              onChange={setField('industry')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-role">Your role</label>
            <select
              id="signup-role"
              name="role"
              value={form.role}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, role: event.target.value as SignupRole }))
              }
            >
              {SIGNUP_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="login-field">
            <label htmlFor="signup-fiscalYearEnd">Fiscal year end</label>
            <input
              id="signup-fiscalYearEnd"
              name="fiscalYearEnd"
              placeholder="e.g. December 31"
              value={form.fiscalYearEnd}
              onChange={setField('fiscalYearEnd')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-entityState">State of record</label>
            <input
              id="signup-entityState"
              name="entityState"
              placeholder="e.g. Delaware"
              value={form.entityState}
              onChange={setField('entityState')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-entityFilingNumber">Filing / registration number</label>
            <input
              id="signup-entityFilingNumber"
              name="entityFilingNumber"
              value={form.entityFilingNumber}
              onChange={setField('entityFilingNumber')}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="signup-entityType">Entity registration</label>
            <select
              id="signup-entityType"
              name="entityType"
              value={form.entityType}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  entityType: event.target.value as SignupPayload['entityType'],
                }))
              }
            >
              {ENTITY_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="login-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>

          {error ? (
            <p className="login-error" role="alert">
              <span className="login-error__mark" aria-hidden="true">
                !
              </span>
              {error}
            </p>
          ) : null}
        </form>

        <p className="login-help">
          Already have an account? <Link to={routePaths.login}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
