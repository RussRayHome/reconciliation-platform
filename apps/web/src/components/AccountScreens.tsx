import { AccountTabs } from './AccountTabs';
import { useAgingThreshold } from '../hooks/useAgingThreshold';
import { useDensity } from '../hooks/useDensity';

/**
 * The signed-in user's own account screens (10c, 12a–12c, UI-12, #451).
 *
 * **Three of the five say what the product does not do yet, and say it specifically.** That is the
 * point rather than a shortfall: password change, MFA, login history, notification delivery and
 * payment do not exist in the domain or the API, and a screen offering a toggle for any of them
 * would promise a capability the platform has not built. A named, specific absence is information;
 * a generic "coming soon" is not.
 *
 * #451 asks for "Security first, because it is where signup's MFA promise lands". MFA has no
 * domain type, no table and no route — verified on `dev` — so Security cannot be first. Profile and
 * Preferences are what the tree can honestly support today.
 */

/** 12a — who you are signed in as, drawn entirely from the live session. */
export function AccountProfileScreen({
  username,
  roleLabel,
  displayName,
  identityVerificationStatus,
  entityVerificationStatus,
}: Readonly<{
  username: string;
  /** Already formatted by App's `roleDisplayLabels`. Taken as a label rather than a raw role so
   * this screen cannot introduce a second role vocabulary that drifts from the header's. */
  roleLabel: string;
  /** The session's display name, which falls back to the username upstream. */
  displayName: string;
  identityVerificationStatus: 'verified' | 'pending';
  /** `failed` is a real third state, not a variant of pending -- a failed check needs a different
   * response from one still running, so it is never collapsed into "Pending". */
  entityVerificationStatus: 'verified' | 'pending' | 'failed';
}>) {
  return (
    <section className="section-card account-screen">
      <h2>Profile</h2>
      <AccountTabs />

      <dl className="account-screen__facts">
        <div>
          <dt>Signed in as</dt>
          <dd>{username}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{roleLabel}</dd>
        </div>
        <div>
          <dt>Name</dt>
          {/* The organization is deliberately NOT shown: the session carries only its UUID, and
              A-D1 keeps internal ids out of the interface. */}
          <dd>{displayName}</dd>
        </div>
        <div>
          <dt>Identity verification</dt>
          <dd>{identityVerificationStatus === 'verified' ? 'Verified' : 'Pending'}</dd>
        </div>
        <div>
          <dt>Entity verification</dt>
          <dd>
            {entityVerificationStatus === 'verified'
              ? 'Verified'
              : entityVerificationStatus === 'failed'
                ? 'Failed'
                : 'Pending'}
          </dd>
        </div>
      </dl>

      <p className="account-screen__note">
        Your name and role are set by an administrator, so they are shown here rather than edited.
        Ask an administrator to change either.
      </p>
    </section>
  );
}

/**
 * 12c — the display preferences that genuinely exist.
 *
 * Both are per-user and already drive real screens: density is the table row height used across
 * the workspace, and the aging threshold is the band boundary on the open items schedule. Neither
 * rewrites a stored figure — they are display lenses, which is why they belong to the person
 * rather than the organization.
 */
export function AccountPreferencesScreen({ username }: Readonly<{ username: string }>) {
  const { density, setDensity } = useDensity(username);
  const { setting, setSetting } = useAgingThreshold(username);

  return (
    <section className="section-card account-screen">
      <h2>Preferences</h2>
      <AccountTabs />

      <div className="account-screen__field">
        <label htmlFor="account-density">Table density</label>
        <select
          id="account-density"
          value={density}
          onChange={(event) => setDensity(event.target.value as typeof density)}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
        <p className="account-screen__note">
          Row height across every table in the workspace. Affects display only.
        </p>
      </div>

      <div className="account-screen__field">
        <label htmlFor="account-aging">Aging threshold</label>
        <select
          id="account-aging"
          value={String(setting.thresholdDays)}
          onChange={(event) =>
            setSetting({ ...setting, thresholdDays: Number(event.target.value) })
          }
        >
          <option value="30">30 days</option>
          <option value="45">45 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
        <p className="account-screen__note">
          Where the open items schedule draws its final band. The last band is always &ldquo;at or
          past the threshold&rdquo;, so raising this moves the boundary rather than adding a band. A
          display lens — it never changes a recorded age.
        </p>
      </div>
    </section>
  );
}

/**
 * A screen that states precisely what is missing and why.
 *
 * Used where the design exists but the capability does not. Naming the missing piece beats a
 * generic placeholder: an operator learns whether to wait, ask, or work around it, and a reader of
 * this codebase learns what is actually unbuilt rather than what is merely unstyled.
 */
function NotBuiltYet({ title, what, why }: Readonly<{ title: string; what: string; why: string }>) {
  return (
    <section className="section-card account-screen">
      <h2>{title}</h2>
      <AccountTabs />
      <p className="account-screen__unbuilt">{what}</p>
      <p className="account-screen__note">{why}</p>
    </section>
  );
}

/** 10c — designed, but the capabilities behind it do not exist. */
export function AccountSecurityScreen() {
  return (
    <NotBuiltYet
      title="Security"
      what="There is nothing to change here yet. Passwords are set by an administrator, multi-factor authentication is not available, and sign-in history is recorded but not yet shown."
      why="Rather than offer controls that would not work, this screen names what is missing. Signing out everywhere, changing your own password and reviewing sign-in history all need work that has not been built."
    />
  );
}

/** 12c's other half — no delivery mechanism exists. */
export function AccountNotificationScreen() {
  return (
    <NotBuiltYet
      title="Notifications"
      what="The product does not send notifications yet, so there is nothing to configure."
      why="Approvals, rule activations and resolved exceptions are all places a notification would belong. Until one of those actually sends something, a preferences page here would only collect settings nothing reads."
    />
  );
}

/** 12b — design-only by decision: no payment capability exists, and signup collects no card. */
export function AccountBillingScreen() {
  return (
    <NotBuiltYet
      title="Billing"
      what="There is no billing to show. The product takes no payment today and signup deliberately collects no card."
      why="A billing screen is designed but held: showing a plan, an invoice or a payment method would describe an arrangement that does not exist. This stays empty until there is a billing decision."
    />
  );
}
