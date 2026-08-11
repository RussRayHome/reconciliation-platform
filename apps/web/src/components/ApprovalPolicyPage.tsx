const PLACEHOLDER_PANELS: ReadonlyArray<{ title: string; description: string }> = [
  {
    title: 'Per-type rules',
    description: 'One row per approvable type -- imported files, mapping profiles, matching rules, variance thresholds, exception resolutions, report distribution -- requires approval y/n.',
  },
  {
    title: 'Approvers & quorum',
    description: 'Named approvers or role, how many must agree, whether self-approval is allowed.',
  },
  {
    title: 'Delegation limits',
    description: 'Amount thresholds that escalate a decision -- e.g. write-offs above $10k.',
  },
  {
    title: 'Default versions',
    description: 'Which mapping profile and rule set are the locked defaults, and the record of who changed them.',
  },
];

/**
 * Structure-agreed, internals-not-designed placeholder (RailMenuMods §6). No backing logic -- the
 * four regions are intentionally empty, matching the design doc's explicit "do not build the
 * internals" instruction. Bulk approve deliberately isn't here: it's a selection mode on the
 * Approvals Pending tab, not a settings page. Admin-only access is enforced by only registering
 * this route for admin/superuser in App.tsx (same pattern as the Run Book route), not by a check
 * inside the component.
 */
export function ApprovalPolicyPage() {
  return (
    <div className="approvals">
      <header className="approvals__header">
        <p className="eyebrow">Review · Settings</p>
        <h1 className="approvals__title">Approval policy</h1>
        <p className="approvals__subcopy">
          Which object types require approval, how many approvers, and the limits above which a
          decision escalates. Visible to admins only.
        </p>
      </header>

      <div className="approvals__policy-grid">
        {PLACEHOLDER_PANELS.map((panel) => (
          <div className="approvals__policy-panel" key={panel.title}>
            <p className="approvals__policy-panel-title">{panel.title}</p>
            <p className="approvals__policy-panel-description">{panel.description}</p>
            <div className="approvals__policy-panel-placeholder" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}
