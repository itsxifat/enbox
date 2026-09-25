import { useUi } from '@/stores/ui';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Renders the promise-based `confirm()` / `choose()` dialogs from the ui store.
 * Mounted once in the root layout.
 */
export function DialogHost() {
  const dialog = useUi((s) => s.dialogs[0]);
  const close = useUi((s) => s.closeDialog);
  if (!dialog) return null;
  const cancel = () => close(dialog.id, null);

  if (dialog.options?.length) {
    return (
      <Modal
        open
        onClose={cancel}
        title={dialog.title}
        description={dialog.message}
        size="sm"
        hideClose
        sheetOnMobile={false}
      >
        <div className="-mx-2 flex flex-col items-stretch pb-3">
          {dialog.options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => close(dialog.id, o.value)}
              className={cn(
                'rounded-xl px-3 py-2.5 text-right text-[15px] font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
                o.danger ? 'text-danger' : 'text-brand-ink',
              )}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={cancel}
            className="rounded-xl px-3 py-2.5 text-right text-[15px] font-medium text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
          >
            {dialog.cancelLabel}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={cancel}
      title={dialog.title}
      size="sm"
      hideClose
      sheetOnMobile={false}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {dialog.cancelLabel}
          </Button>
          <Button
            variant={dialog.danger ? 'danger' : 'primary'}
            onClick={() => close(dialog.id, 'confirm')}
          >
            {dialog.confirmLabel}
          </Button>
        </>
      }
    >
      {dialog.message ? <div className="text-[15px] text-muted">{dialog.message}</div> : null}
    </Modal>
  );
}
