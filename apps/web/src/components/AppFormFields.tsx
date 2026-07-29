import { type ChangeEvent } from 'react';

type SelectOption = {
  value: string;
  label: string;
};

const joinIds = (...ids: Array<string | undefined>): string | undefined => {
  const filtered = ids.filter((item): item is string => Boolean(item));

  return filtered.length > 0 ? filtered.join(' ') : undefined;
};

/** A text input field with an accessible label and persistent one-line helper text. */
export function HelpedTextField({
  fieldId,
  helpText,
  inputId,
  label,
  onChange,
  placeholder,
  value,
}: Readonly<{
  fieldId: string;
  helpText: string;
  inputId: string;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  value: string;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        value={value}
        aria-describedby={helpId}
        onChange={onChange}
        placeholder={placeholder}
      />
      <p id={helpId} className="field-helper-text">
        {helpText}
      </p>
    </div>
  );
}

/** A `<select>` field with an accessible label, persistent helper text, and inline option list. */
export function HelpedSelectField({
  fieldId,
  helpText,
  inputId,
  label,
  hint,
  onChange,
  options,
  value,
}: Readonly<{
  fieldId: string;
  helpText: string;
  inputId: string;
  label: string;
  hint?: { id: string; text: string };
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: ReadonlyArray<SelectOption>;
  value: string;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group">
      <label htmlFor={inputId}>{label}</label>
      <select
        id={inputId}
        value={value}
        aria-describedby={joinIds(helpId, hint?.id)}
        onChange={onChange}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p id={helpId} className="field-helper-text">
        {helpText}
      </p>
      {hint ? (
        <small id={hint.id} className="field-hint">
          {hint.text}
        </small>
      ) : null}
    </div>
  );
}

/** The editable reconciliation label field with a suggested value and reset-to-suggested control. */
export function HelpedLabelField({
  hintId,
  isInvalid,
  labelErrorId,
  onChange,
  periodLabel,
  suggestedPeriodLabel,
  canResetToSuggested,
  onResetToSuggested,
}: Readonly<{
  hintId: string;
  isInvalid: boolean;
  labelErrorId: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  periodLabel: string;
  suggestedPeriodLabel: string;
  canResetToSuggested: boolean;
  onResetToSuggested: () => void;
}>) {
  const fieldId = 'reconciliation-label';
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group">
      <label htmlFor="reconciliation-label-input">Reconciliation label</label>
      <div className="label-input-row">
        <input
          id="reconciliation-label-input"
          value={periodLabel}
          aria-invalid={isInvalid}
          aria-describedby={joinIds(helpId, hintId, isInvalid ? labelErrorId : undefined)}
          onChange={onChange}
          placeholder="Reconciliation label"
        />
        {canResetToSuggested ? (
          <button
            type="button"
            className="secondary-button label-input-row__reset"
            onClick={onResetToSuggested}
          >
            Reset to suggested
          </button>
        ) : null}
      </div>
      <p id={helpId} className="field-helper-text">
        Editable run title used in reports and workbook exports so reviewers can identify the period
        quickly.
      </p>
      <small id={hintId} className="field-hint">
        Suggested: {suggestedPeriodLabel}
      </small>
    </div>
  );
}
