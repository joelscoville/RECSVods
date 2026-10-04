import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';

interface EditorDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Shared native-dialog lifecycle for editor help, account guidance and submission. */
export default function EditorDialog({
  title,
  onClose,
  children,
}: EditorDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="ce-dialog"
      aria-labelledby="ce-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="ce-dialog-head">
        <h2 id="ce-dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button ce-icon"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
