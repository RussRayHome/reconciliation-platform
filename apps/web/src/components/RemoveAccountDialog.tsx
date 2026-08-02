import { useState } from 'react';

/** Type-to-confirm destructive dialog for removing the current account. Stubbed: no delete-account API exists yet. */
export function RemoveAccountDialog({
  username,
  isOpen,
  onClose,
}: Readonly<{
  username: string;
  isOpen: boolean;
  onClose: () => void;
}>) {
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText.trim() === username;

  if (!isOpen) {
    return null;
  }

  const handleConfirm = (): void => {
    // TODO: wire to DELETE /api/account once that endpoint exists.
    setConfirmText('');
    onClose();
  };

  const handleClose = (): void => {
    setConfirmText('');
    onClose();
  };

  return (
    <dialog className="remove-account-modal-backdrop" open aria-label="Remove account confirmation">
      <div
        className="remove-account-modal"
        role="alertdialog"
        aria-labelledby="remove-account-title"
      >
        <h2 id="remove-account-title">Remove account</h2>
        <p>
          This permanently removes account <strong>{username}</strong> and cannot be undone.
        </p>
        <label htmlFor="remove-account-confirm-input">
          Type <strong>{username}</strong> to confirm
        </label>
        <input
          id="remove-account-confirm-input"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          autoComplete="off"
        />
        <div className="remove-account-modal__actions">
          <button type="button" className="secondary-button" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="destructive-button"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Remove account
          </button>
        </div>
      </div>
    </dialog>
  );
}
