import { useState } from 'react';
import { useNavigate } from 'react-router';
import { INVITE_CODE_ALPHABET } from '@enbox/shared';
import { Button, Field, Input, Modal } from '@/components/ui';

/** The invite code inside a pasted link (`…/join/<code>`) or a bare code. */
export function inviteCodeOf(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/join\/([^/?#\s]+)/);
  const code = m ? m[1]! : t;
  const ok = code.length >= 6 && [...code].every((ch) => INVITE_CODE_ALPHABET.includes(ch));
  return ok ? code : null;
}

/** Join a Space with an invite link: the invite page previews it and joins. */
export function JoinSpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const code = inviteCodeOf(value);
  const go = () => {
    if (!code) return;
    onClose();
    setValue('');
    navigate(`/join/${code}`);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join a Space"
      description="Enter an invite link to join an existing Space."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!code} onClick={go}>
            Join Space
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <Field label="Invite link" htmlFor="join-space" error={value && !code ? 'That doesn’t look like an invite link' : undefined}>
          <Input
            id="join-space"
            value={value}
            placeholder="https://enbox.dev/join/…"
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </Field>
      </form>
    </Modal>
  );
}
