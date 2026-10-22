import { useState } from 'react';
import { Heart } from 'lucide-react';
import { COSMETIC_COLLECTIONS } from '@enbox/shared';
import { Button, Modal, toast } from '@/components/ui';
import { selfCardUser } from '@/features/profile/model';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { updateProfile } from '@/features/settings/settingsApi';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { KIND_LABELS, equipPatch, isEquipped, withItem, type Collectible } from './catalog';
import { useFavourites } from './favourites';
import { CollectibleThumb } from './previews';

/**
 * One collectible up close: a try-on on my own profile card (an effect loops on it) and
 * Equip / Unequip, each a direct `PATCH /api/me` of that one field.
 */
export function CollectibleDetailsModal({
  item,
  onClose,
}: {
  item: Collectible | null;
  onClose: () => void;
}) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const favourite = useFavourites((s) => (item ? s.keys.includes(item.key) : false));
  const toggleFavourite = useFavourites((s) => s.toggle);
  if (!item || !me) return null;

  const user = selfCardUser(me);
  const equipped = isEquipped(user, item);
  const tryOn = withItem(user, item);
  const collection = COSMETIC_COLLECTIONS.find((c) => c.id === item.collection);
  const kind = KIND_LABELS[item.kind];

  const run = async (on: boolean) => {
    setBusy(true);
    try {
      await updateProfile(equipPatch(item, on));
      toast.success(on ? `${item.name} equipped` : `${item.name} unequipped`);
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
      title={item.name}
      description={collection ? `${kind} · ${collection.name} collection` : kind}
      size="xl"
      footer={
        <>
          <button
            type="button"
            aria-pressed={favourite}
            aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => toggleFavourite(item.key)}
            className={cn(
              'mr-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
              favourite ? 'text-danger' : 'text-muted',
            )}
          >
            <Heart size={16} fill={favourite ? 'currentColor' : 'none'} aria-hidden />
            {favourite ? 'Favourite' : 'Favourite it'}
          </button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {equipped ? (
            <Button variant="secondary" loading={busy} onClick={() => void run(false)}>
              Unequip
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void run(true)}>
              Equip
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0 sm:w-[300px]" data-testid="try-on">
          {/* `preview`: no actions, and the card loops the profile effect itself. */}
          <div className="overflow-hidden rounded-2xl shadow-sm">
            <ProfileCard user={tryOn} self preview className="rounded-2xl" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="card-inset p-3">
            <CollectibleThumb item={item} user={user} hot />
          </div>
          {collection ? (
            <p className="text-[14px] leading-relaxed text-muted">{collection.description}</p>
          ) : null}
          <p className="text-[13.5px] text-fg">
            {equipped ? (
              <span className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-semibold text-brand-ink">
                Equipped
              </span>
            ) : (
              'Free, like everything here. Equip it now and switch whenever you like.'
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}
