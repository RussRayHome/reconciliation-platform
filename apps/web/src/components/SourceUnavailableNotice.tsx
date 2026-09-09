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
}: Readonly<{
  /** States the procedure that works today, not what is missing. */
  title: string;
  /** The procedure in full, then what this capability would add. Carries no issue number:
   * "arrives with registry validation" ages better than a number that can slip, and the tracking
   * issue belongs in code comments rather than on the screen. */
  reason: string;
}>) {
  return (
    <div className="source-unavailable" role="note">
      <p className="source-unavailable__title">{title}</p>
      <p className="source-unavailable__reason">{reason}</p>
    </div>
  );
}
