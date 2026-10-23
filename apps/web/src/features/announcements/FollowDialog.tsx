/**
 * Follow an announcement channel (Discord's "Follow" modal): pick one of my Spaces where I
 * can manage webhooks, then one of its text channels where I can, then Follow. Its published
 * posts arrive there from then on.
 */
import { useEffect, useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { PERM, hasPerm, type ChatSummary, type ID } from '@enbox/shared';
import { Button, Field, Modal, Spinner, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSpaceList } from '@/stores/spaces';
import { followChannel } from './actions';

const SELECT = 'h-11 w-full rounded-xl bg-surface-2 px-3 disabled:opacity-60';

export function FollowDialog({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const spaces = useSpaceList();
  const manageable = useMemo(
    () => spaces.filter((s) => hasPerm(s.myPermissions, PERM.MANAGE_WEBHOOKS)),
    [spaces],
  );
  const [spaceId, setSpaceId] = useState<ID | ''>('');
  const [channels, setChannels] = useState<ChatSummary[] | null>(null);
  const [channelId, setChannelId] = useState<ID | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChannelId('');
    setChannels(null);
    if (!spaceId) return;
    let live = true;
    api
      .get<ChatSummary[]>(`/api/spaces/${spaceId}/channels`)
      .then((list) => {
        if (!live) return;
        const text = list
          .filter(
            (c) =>
              c.type === 'space_text' &&
              c.id !== chat.id &&
              hasPerm(c.spacePermissions, PERM.MANAGE_WEBHOOKS),
          )
          .sort((a, b) => (a.space?.position ?? 0) - (b.space?.position ?? 0));
        setChannels(text);
        if (text.length === 1) setChannelId(text[0]!.id);
      })
      .catch((e: unknown) => {
        if (live) setChannels([]);
        toast.error(e);
      });
    return () => {
      live = false;
    };
  }, [spaceId, chat.id]);

  const follow = async () => {
    const space = manageable.find((s) => s.id === spaceId);
    const target = channels?.find((c) => c.id === channelId);
    if (!space || !target) return;
    setBusy(true);
    try {
      await followChannel(chat.id, target.id);
      toast.success(`Following #${chat.name} in ${space.name}`);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Follow #${chat.name}`}
      description="Get this channel's published posts in a channel of your own Space."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!channelId}
            onClick={() => void follow()}
            data-testid="follow-submit"
          >
            Follow
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="card-inset flex items-center gap-3 p-3 text-[14px] text-muted">
          <Megaphone size={20} className="shrink-0 text-brand-ink" aria-hidden />
          Posts published in #{chat.name} will show up in the channel you pick, posted by a webhook
          named after this Space.
        </div>
        {manageable.length === 0 ? (
          <p className="text-[14px] text-muted" role="status">
            You need the Manage Webhooks permission in a Space to follow channels into it.
          </p>
        ) : (
          <>
            <Field label="Space" htmlFor="follow-space">
              <select
                id="follow-space"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                className={SELECT}
              >
                <option value="">Select a Space</option>
                {manageable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Channel"
              htmlFor="follow-channel"
              hint={
                channels && channels.length === 0
                  ? 'No text channel there where you can manage webhooks.'
                  : undefined
              }
            >
              <div className="relative">
                <select
                  id="follow-channel"
                  value={channelId}
                  disabled={!spaceId || !channels?.length}
                  onChange={(e) => setChannelId(e.target.value)}
                  className={SELECT}
                >
                  <option value="">Select a channel</option>
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
                {spaceId && !channels ? (
                  <Spinner className="absolute top-3 right-9" size={18} />
                ) : null}
              </div>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
