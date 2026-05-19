import { type ChangeEvent, type ReactNode } from 'react';

import { SemanticIcon } from './SemanticIcon';

type SelectOption = {
  value: string;
  label: string;
};

const joinIds = (...ids: Array<string | undefined>): string | undefined => {
  const filtered = ids.filter((item): item is string => Boolean(item));

  return filtered.length > 0 ? filtered.join(' ') : undefined;
};

function FieldGroupShell({
  fieldId,
  helpId,
  inputId,
  isOpen,
  helpButtonLabel,
  helpText,
  label,
  toggleFieldHelp,
  children,
}: Readonly<{
  fieldId: string;
  helpId: string;
  inputId: string;
  isOpen: boolean;
  helpButtonLabel?: string;
  helpText: ReactNode;
  label: string;
  toggleFieldHelp: (field: string) => void;
  children: ReactNode;
}>) {
  return (
    <div className="field-group" data-help-field={fieldId}>
      <FieldLabelRow
        fieldId={fieldId}
        helpId={helpId}
        inputId={inputId}
        isOpen={isOpen}
        label={label}
        helpButtonLabel={helpButtonLabel}
        toggleFieldHelp={toggleFieldHelp}
      />
      {isOpen ? (
        <small id={helpId} className="field-help-popover">
          {helpText}
        </small>
      ) : null}
      {children}
    </div>
  );
}

/** A file input field with an accessible label, help text, and open/closed accordion behaviour. */
export function HelpedFileField({
  accept,
  fieldId,
  helpText,
  inputId,
  isOpen,
  label,
  onChange,
  toggleFieldHelp,
}: Readonly<{
  accept: string;
  fieldId: string;
  helpText: string;
  inputId: string;
  isOpen: boolean;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  toggleFieldHelp: (field: string) => void;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <FieldGroupShell
      fieldId={fieldId}
      helpId={helpId}
      inputId={inputId}
      isOpen={isOpen}
      label={label}
      helpButtonLabel={fieldId === 'bank-workbook' ? 'bank source file' : label}
      helpText={helpText}
      toggleFieldHelp={toggleFieldHelp}
    >
      <input
        id={inputId}
        type="file"
        accept={accept}
        aria-describedby={isOpen ? helpId : undefined}
        onChange={onChange}
      />
    </FieldGroupShell>
  );
}

/** A text input field with an accessible label, help text, and validation feedback slot. */
export function HelpedTextField({
  fieldId,
  helpText,
  inputId,
  isOpen,
  label,
  onChange,
  placeholder,
  toggleFieldHelp,
  value,
}: Readonly<{
  fieldId: string;
  helpText: string;
  inputId: string;
  isOpen: boolean;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  toggleFieldHelp: (field: string) => void;
  value: string;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <FieldGroupShell
      fieldId={fieldId}
      helpId={helpId}
      inputId={inputId}
      isOpen={isOpen}
      label={label}
      helpText={helpText}
      toggleFieldHelp={toggleFieldHelp}
    >
      <input
        id={inputId}
        value={value}
        aria-describedby={isOpen ? helpId : undefined}
        onChange={onChange}
        placeholder={placeholder}
      />
    </FieldGroupShell>
  );
}

/** A `<select>` field with an accessible label, help text, and inline option list. */
export function HelpedSelectField({
  fieldId,
  helpText,
  inputId,
  isOpen,
  label,
  hint,
  onChange,
  options,
  toggleFieldHelp,
  value,
}: Readonly<{
  fieldId: string;
  helpText: string;
  inputId: string;
  isOpen: boolean;
  label: string;
  hint?: { id: string; text: string };
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: ReadonlyArray<SelectOption>;
  toggleFieldHelp: (field: string) => void;
  value: string;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <FieldGroupShell
      fieldId={fieldId}
      helpId={helpId}
      inputId={inputId}
      isOpen={isOpen}
      label={label}
      helpText={helpText}
      toggleFieldHelp={toggleFieldHelp}
    >
      <select
        id={inputId}
        value={value}
        aria-describedby={joinIds(isOpen ? helpId : undefined, hint?.id)}
        onChange={onChange}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <small id={hint.id} className="field-hint">
          {hint.text}
        </small>
      ) : null}
    </FieldGroupShell>
  );
}

/** A read-only label field that shows a derived value with accessible hint text and validation state. */
export function HelpedLabelField({
  hintId,
  isInvalid,
  isOpen,
  labelErrorId,
  onChange,
  periodLabel,
  suggestedPeriodLabel,
  toggleFieldHelp,
}: Readonly<{
  hintId: string;
  isInvalid: boolean;
  isOpen: boolean;
  labelErrorId: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  periodLabel: string;
  suggestedPeriodLabel: string;
  toggleFieldHelp: (field: string) => void;
}>) {
  const fieldId = 'reconciliation-label';
  const helpId = `${fieldId}-help`;

  return (
    <FieldGroupShell
      fieldId={fieldId}
      helpId={helpId}
      inputId="reconciliation-label-input"
      isOpen={isOpen}
      label="Reconciliation label"
      helpText="Editable run title used in reports and workbook exports so reviewers can identify the period quickly."
      toggleFieldHelp={toggleFieldHelp}
    >
      <div className="label-input-row">
        <input
          id="reconciliation-label-input"
          value={periodLabel}
          aria-invalid={isInvalid}
          aria-describedby={joinIds(
            isOpen ? helpId : undefined,
            hintId,
            isInvalid ? labelErrorId : undefined,
          )}
          onChange={onChange}
          placeholder="Reconciliation label"
        />
      </div>
      <small id={hintId} className="field-hint">
        Suggested: {suggestedPeriodLabel}
      </small>
    </FieldGroupShell>
  );
}

function FieldLabelRow({
  fieldId,
  helpId,
  inputId,
  isOpen,
  helpButtonLabel,
  label,
  toggleFieldHelp,
}: Readonly<{
  fieldId: string;
  helpId: string;
  inputId: string;
  isOpen: boolean;
  helpButtonLabel?: string;
  label: string;
  toggleFieldHelp: (field: string) => void;
}>) {
  const helpActionLabel = isOpen ? 'Close' : 'Open';
  const resolvedHelpButtonLabel = helpButtonLabel
    ? `${helpActionLabel} help for ${helpButtonLabel.toLowerCase()}`
    : `${helpActionLabel} help for this field`;

  return (
    <div className="field-label-row">
      <label htmlFor={inputId}>{label}</label>
      <button
        type="button"
        className="help-icon-button"
        aria-label={resolvedHelpButtonLabel}
        aria-expanded={isOpen}
        aria-controls={helpId}
        onClick={() => toggleFieldHelp(fieldId)}
      >
        <SemanticIcon name="help" className="help-icon" />
      </button>
    </div>
  );
}
