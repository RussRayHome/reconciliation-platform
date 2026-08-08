import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import type { AuthenticatedUserSession } from '../App';
import {
  entityVerificationCheckRequest,
  identityConfirmRequest,
  identityResendRequest,
  signupRequest,
  type EntityVerificationCheckResponse,
  type SignupPayload,
  type SignupRole,
} from '../lib/api';
import { routePaths } from '../routes/routePaths';
import kinneyHighlander from '../assets/kinney-highlander.png';

type Tone = 'ok' | 'error' | 'muted';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_RULES: ReadonlyArray<{ label: string; test: (pw: string) => boolean }> = [
  { label: 'At least 10 characters', test: (pw) => pw.length >= 10 },
  { label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { label: 'One number', test: (pw) => /[0-9]/.test(pw) },
  { label: 'One symbol (!@#$…)', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];
const passwordRuleState = (pw: string) => PASSWORD_RULES.map((r) => r.test(pw));
const passwordAllMet = (pw: string) => passwordRuleState(pw).every(Boolean);

const SIGNUP_ROLES: ReadonlyArray<{ value: SignupRole; label: string }> = [
  { value: 'financial-analyst', label: 'Financial Analyst' },
  { value: 'senior-analyst', label: 'Senior Analyst' },
  { value: 'staff-accountant', label: 'Staff Accountant' },
  { value: 'controller', label: 'Controller' },
  { value: 'vp-finance', label: 'VP Finance' },
  { value: 'cfo', label: 'CFO' },
];

const ENTITY_TYPES: ReadonlyArray<{
  id: SignupPayload['entityType'];
  label: string;
  desc: string;
}> = [
  { id: 'domestic', label: 'Domestic entity', desc: 'Formed in this state' },
  { id: 'foreign', label: 'Foreign entity', desc: 'Formed elsewhere, registered to transact here' },
];

const VERIFICATION_CHANNELS: ReadonlyArray<{
  id: SignupPayload['verificationChannel'];
  label: string;
  desc: string;
}> = [
  { id: 'email', label: 'Email verification', desc: 'Six-digit code sent to your work email address.' },
  { id: 'sms', label: 'Text message to phone', desc: 'Six-digit code sent by SMS to your mobile number.' },
];

// Cosmetic only -- billing/card collection is out of scope this round, so unlike the mockup this
// intentionally has no card-number/expiry/CVC fields. Faking those would collect input that's
// silently discarded, which is worse than not asking. "Due today" stays $0 either way.
const PLANS: ReadonlyArray<{ id: string; tag: string; price: string; unit: string }> = [
  { id: 'core', tag: 'Core', price: '$240', unit: 'per entity / month' },
  { id: 'growth', tag: 'Growth', price: '$620', unit: 'per entity / month' },
  { id: 'enterprise', tag: 'Enterprise', price: 'Custom', unit: 'annual contract' },
];

const NEXT_STEPS = [
  { num: '01', label: 'Connect a bank feed', meta: '2 min' },
  { num: '02', label: 'Import general ledger', meta: 'CSV or ERP' },
  { num: '03', label: 'Run first reconciliation', meta: 'Automatic' },
];

const emailNote = (value: string): { note: string; tone: Tone } => {
  if (!value) return { note: '', tone: 'muted' };
  if (!EMAIL_PATTERN.test(value)) return { note: 'Enter a valid work email address.', tone: 'error' };
  return { note: 'Looks good.', tone: 'ok' };
};

const usernameNote = (value: string): { note: string; tone: Tone } => {
  if (!value) return { note: '', tone: 'muted' };
  if (value.includes('@')) return { note: 'Username cannot be an email address.', tone: 'error' };
  if (value.length < 4) return { note: 'Username must be at least 4 characters.', tone: 'error' };
  return { note: 'Available format.', tone: 'ok' };
};

const phoneNote = (value: string, requiredForSms: boolean): { note: string; tone: Tone } => {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return requiredForSms
      ? { note: 'A mobile number is required to verify by text.', tone: 'error' }
      : { note: '', tone: 'muted' };
  }
  const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (national.length !== 10) {
    return { note: 'Enter a full US mobile number, 10 digits.', tone: 'error' };
  }
  return { note: `We can text a code to •••• ${national.slice(-4)}.`, tone: 'ok' };
};

const emptyForm: SignupPayload = {
  email: '',
  fullName: '',
  username: '',
  password: '',
  phone: '',
  companyName: '',
  headcount: '',
  industry: '',
  role: 'financial-analyst',
  fiscalYearEnd: 'December 31',
  entityState: '',
  entityFilingNumber: '',
  entityType: 'domestic',
  verificationChannel: 'email',
};

type SosStatus = 'idle' | 'incomplete' | 'checking' | 'verified' | 'failed';
type ModalStage = '' | 'verify' | 'otp' | 'done';

/**
 * Single-page signup matching the design mockup's structure: credentials, company, an inline
 * Secretary of State pre-check, verification-method + MFA choice, plan selection, and an
 * order-summary rail -- then a post-submit modal (confirm code -> optional mock authenticator
 * pairing -> done).
 *
 * The inline SoS check is advisory, not blocking: account creation waits only on the fields this
 * form validates itself (credentials + company), per the approved design -- entity verification
 * resolves asynchronously against the already-created account (see
 * entityVerificationService.ts), the same way it does when retried later from a logged-in
 * session. Blocking submission on it here would misrepresent how the backend actually behaves.
 */
export function SignupScreen({
  onAuthenticated,
}: Readonly<{
  onAuthenticated: (session: AuthenticatedUserSession) => void;
}>) {
  const [form, setForm] = useState<SignupPayload>(emptyForm);
  const [plan, setPlan] = useState('growth');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [tried, setTried] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [tsStatus, setTsStatus] = useState<'checking' | 'verified'>('checking');
  useEffect(() => {
    const timer = setTimeout(() => setTsStatus('verified'), 1400);
    return () => clearTimeout(timer);
  }, []);

  const [sosStatus, setSosStatus] = useState<SosStatus>('idle');
  const [sosMessage, setSosMessage] = useState('');
  const [sosResult, setSosResult] = useState<EntityVerificationCheckResponse | null>(null);

  const [session, setSession] = useState<AuthenticatedUserSession | null>(null);
  const [modal, setModal] = useState<ModalStage>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [otp, setOtp] = useState('');

  const setField =
    (field: keyof SignupPayload) =>
    (event: { target: { value: string } }): void => {
      setForm((previous) => ({ ...previous, [field]: event.target.value }));
      setSosStatus((prev) => (field === 'companyName' ? 'idle' : prev));
    };

  const emailCheck = emailNote(form.email);
  const usernameCheck = usernameNote(form.username);
  const phoneCheck = phoneNote(form.phone, form.verificationChannel === 'sms');
  const pwMet = passwordRuleState(form.password);
  const pwMetCount = pwMet.filter(Boolean).length;

  const verifyEntity = (): void => {
    if (!form.companyName.trim()) {
      setSosStatus('incomplete');
      setSosMessage('Enter the legal entity name above before verifying.');
      return;
    }
    if (!form.entityState.trim()) {
      setSosStatus('incomplete');
      setSosMessage('Select the state where the entity is on record.');
      return;
    }
    if (form.entityFilingNumber.replace(/[^A-Za-z0-9]/g, '').length < 4) {
      setSosStatus('incomplete');
      setSosMessage('Enter the filing or registration number issued by the Secretary of State.');
      return;
    }

    setSosStatus('checking');
    setSosMessage('');
    void entityVerificationCheckRequest({
      companyName: form.companyName,
      entityState: form.entityState,
      entityFilingNumber: form.entityFilingNumber,
      entityType: form.entityType,
    })
      .then((result) => {
        setSosResult(result);
        setSosStatus(result.status);
      })
      .catch(() => {
        setSosStatus('incomplete');
        setSosMessage('The Secretary of State check could not run. You can still create your account.');
      });
  };

  // Always computed, regardless of `tried` -- handleSubmit's guard reads this synchronously on
  // the very first submit, before the `setTried(true)` it just called has re-rendered. Gating
  // this list on `tried` made it stale on that first click (still reflecting the pre-submit
  // render's `tried = false`), so the guard saw an empty list and let an invalid request reach
  // the backend. Display is still gated on `tried` at the render site below; only the
  // computation itself needed to stop depending on it.
  const problems: string[] = [];
  if (!form.email.trim()) problems.push('Work email is required.');
  else if (emailCheck.tone === 'error') problems.push(emailCheck.note);
  if (!form.fullName.trim()) problems.push('Full name is required for audit records.');
  if (!form.username.trim()) problems.push('Choose a username.');
  else if (usernameCheck.tone === 'error') problems.push(usernameCheck.note);
  if (!passwordAllMet(form.password)) problems.push('Password does not meet all five requirements.');
  if (phoneCheck.tone === 'error') problems.push(phoneCheck.note);
  if (!form.companyName.trim()) problems.push('Legal entity name is required.');
  if (!form.headcount) problems.push('Select a headcount range.');
  if (!form.industry) problems.push('Select an industry.');
  if (!form.entityState.trim()) problems.push('Select the state where the entity is on record.');
  if (!form.entityFilingNumber.trim()) problems.push('Enter the Secretary of State filing number.');
  if (!termsAccepted) problems.push('Accept the Terms of Service and Data Processing Addendum.');

  const handleSubmit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    setTried(true);
    setSubmitError(null);
    if (problems.length > 0 || isSubmitting) return;

    setIsSubmitting(true);
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
        setModal('verify');
      })
      .catch((error: unknown) => {
        setSubmitError(error instanceof Error ? error.message : 'Signup failed. Try again.');
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const setCodeCell = (index: number) => (event: { target: { value: string } }): void => {
    const value = event.target.value.replace(/\D/g, '').slice(-1);
    setCode((previous) => {
      const next = previous.slice();
      next[index] = value;
      return next;
    });
    setModalError(null);
  };

  const finishAndEnter = (verifiedSession: AuthenticatedUserSession): void => {
    setModal('');
    onAuthenticated(verifiedSession);
  };

  const modalNext = (): void => {
    if (!session) return;

    if (modal === 'verify') {
      const joined = code.join('');
      if (joined.length !== 6) {
        setModalError('Enter all six digits.');
        return;
      }
      setModalSubmitting(true);
      void identityConfirmRequest(joined)
        .then(() => {
          const verified: AuthenticatedUserSession = { ...session, identityVerificationStatus: 'verified' };
          setSession(verified);
          setModal(mfaEnabled ? 'otp' : 'done');
          setModalError(null);
        })
        .catch((error: unknown) => {
          setModalError(error instanceof Error ? error.message : 'That code is invalid or has expired.');
        })
        .finally(() => {
          setModalSubmitting(false);
        });
      return;
    }

    if (modal === 'otp') {
      // Mock pairing only -- no TOTP secret is generated, stored, or checked at login. Matches
      // the same "seam, not a real vendor" pattern already used for entity verification and the
      // identity code channel; real MFA enforcement remains a separate, unbuilt decision.
      if (otp.length !== 6) {
        setModalError('Enter the six-digit code from your authenticator app.');
        return;
      }
      setModal('done');
      setModalError(null);
      return;
    }

    finishAndEnter(session);
  };

  const resendCode = (): void => {
    setModalError(null);
    void identityResendRequest().catch((error: unknown) => {
      setModalError(error instanceof Error ? error.message : 'Could not resend the code.');
    });
  };

  const steps = [
    {
      label: 'Credentials',
      done:
        emailCheck.tone === 'ok' &&
        !!form.fullName.trim() &&
        usernameCheck.tone === 'ok' &&
        passwordAllMet(form.password),
    },
    { label: 'Company', done: !!form.companyName.trim() && !!form.headcount && !!form.industry },
    { label: 'Entity', done: sosStatus === 'verified' },
    { label: 'Plan & terms', done: termsAccepted && tsStatus === 'verified' },
    { label: 'Confirm identity', done: modal === 'done' },
  ];
  const currentStepIndex = steps.findIndex((step) => !step.done);

  const sosBadge =
    sosStatus === 'verified'
      ? { label: 'Verified', tone: 'ok' as const }
      : sosStatus === 'failed'
        ? { label: 'Not found', tone: 'error' as const }
        : sosStatus === 'checking'
          ? { label: 'Checking…', tone: 'muted' as const }
          : sosStatus === 'incomplete'
            ? { label: 'Incomplete', tone: 'error' as const }
            : { label: 'Not yet checked', tone: 'muted' as const };

  return (
    <div className="signup-page">
      <div className="signup-shell">
        <div className="signup-header">
          <div className="signup-header__brand">
            <img src={kinneyHighlander} alt="Kinney Software Solutions logo" className="signup-header__logo" />
            <span className="signup-header__company">Kinney Software Solutions LLC</span>
            <span className="signup-header__product">Reconciliation Platform</span>
          </div>
          <Link to={routePaths.login} className="signup-header__login">
            Already registered? Log in
          </Link>
        </div>

        <div className="signup-track">
          {steps.map((step, index) => (
            <div className="signup-track__step" key={step.label}>
              <span
                className={
                  'signup-track__mark' +
                  (step.done
                    ? ' signup-track__mark--done'
                    : index === currentStepIndex
                      ? ' signup-track__mark--current'
                      : '')
                }
              >
                {step.done ? '✓' : index + 1}
              </span>
              <span
                className={
                  'signup-track__label' + (index === currentStepIndex ? ' signup-track__label--current' : '')
                }
              >
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span className={'signup-track__line' + (step.done ? ' signup-track__line--done' : '')} />
              ) : null}
            </div>
          ))}
        </div>

        <form className="signup-body" onSubmit={handleSubmit}>
          <div>
            <div className="signup-intro">
              <h1>Create an account</h1>
              <p>
                One form. After you submit, we confirm your identity with a code by email or text — and
                pair an authenticator app if you turn it on. The trial starts immediately.
              </p>
            </div>

            {tried && problems.length > 0 ? (
              <div className="signup-error-box">
                <span className="signup-error-box__title">
                  Account could not be created — {problems.length}{' '}
                  {problems.length === 1 ? 'item needs' : 'items need'} attention
                </span>
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {submitError ? (
              <div className="signup-error-box">
                <span className="signup-error-box__title">{submitError}</span>
              </div>
            ) : null}

            <div className="signup-section">
              <span className="signup-section__label">01 · Credentials</span>
              <span className="signup-section__line" />
            </div>
            <div className="signup-grid">
              <div className="signup-field signup-grid--span2">
                <label htmlFor="signup-email">Work email</label>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={setField('email')}
                  data-invalid={tried && emailCheck.tone === 'error'}
                />
                {emailCheck.note ? (
                  <span className={`signup-note signup-note--${emailCheck.tone}`}>{emailCheck.note}</span>
                ) : null}
              </div>
              <div className="signup-field">
                <label htmlFor="signup-fullName">Full name</label>
                <input
                  id="signup-fullName"
                  name="fullName"
                  autoComplete="name"
                  value={form.fullName}
                  onChange={setField('fullName')}
                  data-invalid={tried && !form.fullName.trim()}
                />
              </div>
              <div className="signup-field">
                <label htmlFor="signup-username">Username</label>
                <input
                  id="signup-username"
                  name="username"
                  autoComplete="username"
                  value={form.username}
                  onChange={setField('username')}
                  data-invalid={tried && usernameCheck.tone === 'error'}
                />
                {usernameCheck.note ? (
                  <span className={`signup-note signup-note--${usernameCheck.tone}`}>{usernameCheck.note}</span>
                ) : null}
              </div>
              <div className="signup-field signup-grid--span2">
                <label htmlFor="signup-phone">
                  Mobile phone <span style={{ fontWeight: 400 }}>— for text verification and recovery</span>
                </label>
                <input
                  id="signup-phone"
                  name="phone"
                  autoComplete="tel"
                  placeholder="+1 (555) 014-2288"
                  value={form.phone}
                  onChange={setField('phone')}
                  data-invalid={tried && phoneCheck.tone === 'error'}
                />
                {phoneCheck.note ? (
                  <span className={`signup-note signup-note--${phoneCheck.tone}`}>{phoneCheck.note}</span>
                ) : null}
              </div>
              <div className="signup-field signup-grid--span2">
                <label htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={setField('password')}
                  data-invalid={tried && !passwordAllMet(form.password)}
                />
                <div className="signup-pw-meter">
                  {[0, 1, 2, 3].map((barIndex) => (
                    <span
                      key={barIndex}
                      className={
                        'signup-pw-meter__bar' +
                        (barIndex < Math.round(pwMetCount * 0.8) ? ' signup-pw-meter__bar--filled' : '')
                      }
                    />
                  ))}
                </div>
                <div className="signup-pw-rules">
                  {PASSWORD_RULES.map((rule, index) => (
                    <span
                      key={rule.label}
                      className={'signup-pw-rule' + (pwMet[index] ? ' signup-pw-rule--met' : '')}
                    >
                      <span className="signup-pw-rule__mark">{pwMet[index] ? '✓' : ''}</span>
                      {rule.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="signup-section">
              <span className="signup-section__label">02 · Company</span>
              <span className="signup-section__line" />
            </div>
            <div className="signup-grid">
              <div className="signup-field signup-grid--span2">
                <label htmlFor="signup-companyName">Legal entity name</label>
                <input
                  id="signup-companyName"
                  name="companyName"
                  value={form.companyName}
                  onChange={setField('companyName')}
                  data-invalid={tried && !form.companyName.trim()}
                />
              </div>
              <div className="signup-field">
                <label htmlFor="signup-headcount">Headcount</label>
                <select
                  id="signup-headcount"
                  name="headcount"
                  value={form.headcount}
                  onChange={setField('headcount')}
                  data-invalid={tried && !form.headcount}
                >
                  <option value="">Select…</option>
                  <option value="1-50">1–50</option>
                  <option value="51-250">51–250</option>
                  <option value="251-1000">251–1,000</option>
                  <option value="1000+">1,000+</option>
                </select>
              </div>
              <div className="signup-field">
                <label htmlFor="signup-industry">Industry</label>
                <select
                  id="signup-industry"
                  name="industry"
                  value={form.industry}
                  onChange={setField('industry')}
                  data-invalid={tried && !form.industry}
                >
                  <option value="">Select…</option>
                  <option value="saas">Software &amp; SaaS</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="retail">Retail &amp; e-commerce</option>
                  <option value="financial">Financial services</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="signup-field">
                <label htmlFor="signup-role">Your role</label>
                <select id="signup-role" name="role" value={form.role} onChange={setField('role')}>
                  {SIGNUP_ROLES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="signup-field">
                <label htmlFor="signup-fiscalYearEnd">Fiscal year end</label>
                <select
                  id="signup-fiscalYearEnd"
                  name="fiscalYearEnd"
                  value={form.fiscalYearEnd}
                  onChange={setField('fiscalYearEnd')}
                >
                  <option value="December 31">31 December</option>
                  <option value="March 31">31 March</option>
                  <option value="June 30">30 June</option>
                  <option value="September 30">30 September</option>
                </select>
              </div>
            </div>

            <div
              className={
                'signup-panel' +
                (sosStatus === 'verified' ? ' signup-panel--ok' : sosStatus === 'failed' ? ' signup-panel--error' : '')
              }
            >
              <div className="signup-panel__head">
                <span className="signup-panel__title">Entity verification — Secretary of State</span>
                <span className={`signup-panel__badge signup-panel__badge--${sosBadge.tone}`}>{sosBadge.label}</span>
              </div>
              <p>
                US-registered entities only. We match your entity against the Secretary of State register in
                its state of record. This check is optional here — your account is created either way, and we
                verify in the background if you skip it.
              </p>
              <div className="signup-grid">
                <div className="signup-field">
                  <label htmlFor="signup-entityState">State of record</label>
                  <select
                    id="signup-entityState"
                    name="entityState"
                    value={form.entityState}
                    onChange={setField('entityState')}
                    data-invalid={tried && !form.entityState.trim()}
                  >
                    <option value="">Select state…</option>
                    {[
                      'Delaware',
                      'California',
                      'New York',
                      'Texas',
                      'Florida',
                      'Illinois',
                      'Washington',
                      'Massachusetts',
                      'Nevada',
                      'Colorado',
                      'Georgia',
                      'North Carolina',
                      'Ohio',
                      'Pennsylvania',
                    ].map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="signup-field">
                  <label htmlFor="signup-entityFilingNumber">Filing / registration number</label>
                  <input
                    id="signup-entityFilingNumber"
                    name="entityFilingNumber"
                    value={form.entityFilingNumber}
                    onChange={setField('entityFilingNumber')}
                    placeholder="e.g. 7412903"
                    data-invalid={tried && !form.entityFilingNumber.trim()}
                  />
                </div>
              </div>

              <div className="signup-choice-grid">
                {ENTITY_TYPES.map((entityType) => {
                  const active = form.entityType === entityType.id;
                  return (
                    <button
                      type="button"
                      key={entityType.id}
                      className={'signup-choice' + (active ? ' signup-choice--active' : '')}
                      onClick={() => setForm((previous) => ({ ...previous, entityType: entityType.id }))}
                    >
                      <span className="signup-choice__dot">
                        <span className="signup-choice__dot-inner" />
                      </span>
                      <span>
                        <span className="signup-choice__label">{entityType.label}</span>
                        <div className="signup-choice__desc">{entityType.desc}</div>
                      </span>
                    </button>
                  );
                })}
              </div>

              {sosStatus === 'verified' && sosResult ? (
                <div className="signup-sos-details">
                  <div className="signup-sos-details__row">
                    <span className="signup-sos-details__k">Registered name</span>
                    <span className="signup-sos-details__v">{sosResult.registeredName ?? form.companyName}</span>
                  </div>
                  <div className="signup-sos-details__row">
                    <span className="signup-sos-details__k">Standing</span>
                    <span className="signup-sos-details__v">{sosResult.standing ?? 'active'}</span>
                  </div>
                </div>
              ) : null}
              {sosStatus === 'failed' ? (
                <p style={{ color: 'var(--negative)' }}>
                  No active record matched that filing number. Double-check it, or continue anyway — you can
                  retry from your account after signing up.
                </p>
              ) : null}
              {sosStatus === 'incomplete' ? <p style={{ color: 'var(--negative)' }}>{sosMessage}</p> : null}

              <button
                type="button"
                className="signup-btn-outline"
                onClick={verifyEntity}
                disabled={sosStatus === 'checking'}
              >
                {sosStatus === 'checking'
                  ? 'Checking register…'
                  : sosStatus === 'verified'
                    ? 'Re-run verification'
                    : 'Verify with Secretary of State'}
              </button>
            </div>

            <div className="signup-section">
              <span className="signup-section__label">03 · Verification</span>
              <span className="signup-section__line" />
            </div>
            <div className="signup-choice-grid">
              {VERIFICATION_CHANNELS.map((channel) => {
                const active = form.verificationChannel === channel.id;
                return (
                  <button
                    type="button"
                    key={channel.id}
                    className={'signup-choice' + (active ? ' signup-choice--active' : '')}
                    onClick={() => setForm((previous) => ({ ...previous, verificationChannel: channel.id }))}
                  >
                    <span className="signup-choice__dot">
                      <span className="signup-choice__dot-inner" />
                    </span>
                    <span>
                      <span className="signup-choice__label">{channel.label}</span>
                      <div className="signup-choice__desc">{channel.desc}</div>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="signup-toggle-row">
              <button
                type="button"
                className={'signup-toggle' + (mfaEnabled ? ' signup-toggle--on' : '')}
                onClick={() => setMfaEnabled((previous) => !previous)}
                aria-pressed={mfaEnabled}
                aria-label="Add an authenticator app"
              >
                <span className="signup-toggle__knob" />
              </button>
              <div>
                <div className="signup-toggle-row__title">Add an authenticator app (MFA)</div>
                <div className="signup-toggle-row__note">
                  {mfaEnabled
                    ? 'On — after confirming your code you will pair an authenticator app.'
                    : 'Recommended. Adds a time-based code from an authenticator app on top of the method above.'}
                </div>
              </div>
            </div>

            <div className="signup-section">
              <span className="signup-section__label">04 · Plan</span>
              <span className="signup-section__line" />
            </div>
            <div className="signup-plans">
              {PLANS.map((planOption) => (
                <button
                  type="button"
                  key={planOption.id}
                  className={'signup-plan' + (plan === planOption.id ? ' signup-plan--active' : '')}
                  onClick={() => setPlan(planOption.id)}
                >
                  <span className="signup-plan__tag">{planOption.tag}</span>
                  <span className="signup-plan__price">{planOption.price}</span>
                  <span className="signup-plan__unit">{planOption.unit}</span>
                </button>
              ))}
            </div>

            <div className="signup-ts">
              <span
                className={
                  'signup-ts__mark' +
                  (tsStatus === 'verified' ? ' signup-ts__mark--ok' : ' signup-ts__mark--checking')
                }
              >
                {tsStatus === 'verified' ? '✓' : ''}
              </span>
              <div>
                <div className={'signup-ts__label' + (tsStatus === 'verified' ? ' signup-ts__label--ok' : '')}>
                  {tsStatus === 'verified' ? 'Verified — you are human' : 'Verifying you are human…'}
                </div>
                <div className="signup-ts__sub">Runs in the background — no puzzle required.</div>
              </div>
            </div>

            <button
              type="button"
              className="signup-terms"
              onClick={() => setTermsAccepted((previous) => !previous)}
            >
              <span className={'signup-terms__box' + (termsAccepted ? ' signup-terms__box--checked' : '')}>
                {termsAccepted ? '✓' : ''}
              </span>
              <span className="signup-terms__text">
                I accept the Terms of Service and Data Processing Addendum, and confirm I am authorised to
                connect this company&apos;s bank and ledger data.
              </span>
            </button>

            <button type="submit" className="signup-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account and start trial'}
            </button>
          </div>

          <aside className="signup-rail">
            <div className="signup-rail__card">
              <span className="signup-rail__eyebrow">Order summary</span>
              <div className="signup-rail__row">
                <span className="signup-rail__row-key">Plan</span>
                <span className="signup-rail__row-val">{PLANS.find((p) => p.id === plan)?.tag ?? '—'}</span>
              </div>
              <div className="signup-rail__row">
                <span className="signup-rail__row-key">Entity</span>
                <span className="signup-rail__row-val">{form.companyName || 'Not set'}</span>
              </div>
              <div className="signup-rail__row">
                <span className="signup-rail__row-key">SoS verification</span>
                <span className="signup-rail__row-val">{sosBadge.label}</span>
              </div>
              <div className="signup-rail__row">
                <span className="signup-rail__row-key">Role</span>
                <span className="signup-rail__row-val">
                  {SIGNUP_ROLES.find((r) => r.value === form.role)?.label ?? 'Not set'}
                </span>
              </div>
              <div className="signup-rail__row">
                <span className="signup-rail__row-key">Sign-in security</span>
                <span className="signup-rail__row-val">
                  {form.verificationChannel === 'sms' ? 'SMS code' : 'Email code'}
                  {mfaEnabled ? ' + MFA' : ''}
                </span>
              </div>
              <div className="signup-rail__due">
                <span>Due today</span>
                <span className="signup-rail__due-amount">$0.00</span>
              </div>
              <p className="signup-rail__note">Card is collected at the end of the trial, not today.</p>
            </div>
            <div className="signup-rail__card">
              <span className="signup-rail__eyebrow">Included in every plan</span>
              <div className="signup-rail__included">
                <div className="signup-rail__included-item">Automated bank-to-GL matching</div>
                <div className="signup-rail__included-item">Exception queue with audit trail</div>
                <div className="signup-rail__included-item">Unlimited read-only viewers</div>
              </div>
            </div>
          </aside>
        </form>
      </div>

      {modal && session ? (
        <div className="signup-modal-backdrop">
          <div className="signup-modal">
            <div className="signup-modal__head">
              <span className="signup-modal__step">
                {modal === 'verify'
                  ? mfaEnabled
                    ? 'Step 1 of 2'
                    : 'Step 1 of 1'
                  : modal === 'otp'
                    ? 'Step 2 of 2'
                    : 'Complete'}
              </span>
              {modal !== 'done' ? (
                <button
                  type="button"
                  className="signup-modal__close"
                  onClick={() => finishAndEnter(session)}
                  aria-label="Skip and enter the app"
                >
                  ×
                </button>
              ) : null}
            </div>

            {modal === 'verify' ? (
              <>
                <h3>{form.verificationChannel === 'sms' ? 'Confirm your phone number' : 'Verify your email'}</h3>
                <p>
                  {form.verificationChannel === 'sms'
                    ? `We texted a six-digit code to ${form.phone || 'your mobile number'}.`
                    : `We sent a six-digit code to ${form.email || 'your work email address'}.`}{' '}
                  It expires in 10 minutes.
                </p>
                <div className="signup-code-cells">
                  {code.map((digit, index) => (
                    <input
                      key={`code-cell-${index}`}
                      value={digit}
                      onChange={setCodeCell(index)}
                      inputMode="numeric"
                      maxLength={1}
                    />
                  ))}
                </div>
                <button type="button" className="signup-modal__skip" onClick={resendCode}>
                  Resend code
                </button>
              </>
            ) : null}

            {modal === 'otp' ? (
              <>
                <h3>Pair your authenticator app</h3>
                <p>Scan the code in your authenticator app, then enter the six digits it shows.</p>
                <div className="signup-otp-row">
                  <div className="signup-otp-qr">QR code</div>
                  <div style={{ flex: 1 }}>
                    <span className="signup-note signup-note--muted">Manual key</span>
                    <div className="signup-otp-key">KNNY 4KQ2 8XJP 91TF</div>
                    <input
                      className="signup-otp-input"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      inputMode="numeric"
                      maxLength={6}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {modal === 'done' ? (
              <>
                <h3>Account created</h3>
                <p>
                  Your workspace for {form.companyName || 'your company'} is provisioned. Sign-in is protected
                  by {form.verificationChannel === 'sms' ? 'SMS codes' : 'email codes'}
                  {mfaEnabled ? ' plus an authenticator app.' : '.'}
                </p>
                <div className="signup-next-steps">
                  {NEXT_STEPS.map((step) => (
                    <div className="signup-next-steps__row" key={step.num}>
                      <span className="signup-next-steps__num">{step.num}</span>
                      <span className="signup-next-steps__label">{step.label}</span>
                      <span className="signup-next-steps__meta">{step.meta}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {modalError ? <div className="signup-modal-error">{modalError}</div> : null}

            <button type="button" className="signup-modal__cta" onClick={modalNext} disabled={modalSubmitting}>
              {modal === 'verify'
                ? modalSubmitting
                  ? 'Confirming…'
                  : form.verificationChannel === 'sms'
                    ? 'Confirm phone'
                    : 'Verify email'
                : modal === 'otp'
                  ? 'Pair and finish'
                  : 'Go to workspace'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
