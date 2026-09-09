/**
 * The "not available" half of [OBJECT] rule 27: where the platform cannot do a thing yet, the
 * control is **removed and replaced by a reason** — never rendered greyed out.
 *
 * This is deliberately not the rule's other half. A control the *user* can enable (Submit run
 * before the bank statements and GL are attached; 3a's opening panel before an account number is
 * entered) stays put, disabled, with its reason beside it — that is approved on 1a and must not be
 * refactored into this component. The test is whether any sequence of user actions makes the
 * control work: if yes, disable it; if no, replace it with this.
 *
 * First consumer is the Payroll tab on 1a (#408). Two more are known: the Mapping return path on
 * 13a, and 5a/5b's registry validation before #448.
 */
export function SourceUnavailableNotice({
  title,
  reason,
  trackingIssue,
}: Readonly<{
  title: string;
  /** One sentence: why it cannot be done, and what to do meanwhile. */
  reason: string;
  /** The issue that delivers the capability, so the reason names something a reader can look up
   * rather than reading as a permanent limitation. */
  trackingIssue: string;
}>) {
  return (
    <div className="source-unavailable" role="note">
      <p className="source-unavailable__title">{title}</p>
      <p className="source-unavailable__reason">{reason}</p>
      <p className="source-unavailable__tracking">
        Tracked in <span className="source-unavailable__issue">{trackingIssue}</span>
      </p>
    </div>
  );
}
