/**
 * My profile photo and banner with a camera badge (web settings/profile/AvatarEditor +
 * BannerEditor): view, upload (gallery or camera, system cropper) or remove.
 */
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Camera, Eye, ImagePlus, Trash2 } from 'lucide-react-native';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { Avatar, Menu, Press, Spinner, confirm, measureAnchor, toast } from '@/components/ui';
import { PhotoViewer } from '@/features/contacts/PhotoViewer';
import { mediaUrl } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { useTheme } from '@/theme';
import { changeAvatar, changeBanner, removeAvatar, removeBanner } from './profileMedia';

function useMediaEditor({ has, change, remove, labels }) {
  const ref = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    try {
      setBusy(true);
      const done = await change();
      if (done) toast.success(labels.updated);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    const ok = await confirm({
      title: labels.removeTitle,
      message: labels.removeMessage,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await remove();
      toast.success(labels.removed);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const items = [
    has && { label: labels.view, icon: Eye, onSelect: () => setViewing(true) },
    {
      label: has ? labels.uploadNew : labels.upload,
      icon: ImagePlus,
      onSelect: () => void upload(),
    },
    has && 'separator',
    has && { label: labels.remove, icon: Trash2, danger: true, onSelect: () => void doRemove() },
  ];

  const open = async () => {
    if (!has) return void upload();
    const a = await measureAnchor(ref);
    if (a) setAnchor(a);
    setMenuOpen(true);
  };

  return { ref, anchor, menuOpen, setMenuOpen, viewing, setViewing, busy, items, open };
}

export function AvatarEditor({ size = 160 }) {
  const { tw, c, shadow } = useTheme();
  const me = useMe();
  const e = useMediaEditor({
    has: !!me?.avatarUrl,
    change: () => changeAvatar(),
    remove: removeAvatar,
    labels: {
      view: 'View photo',
      upload: 'Upload photo',
      uploadNew: 'Upload new photo',
      remove: 'Remove photo',
      removeTitle: 'Remove profile photo?',
      removeMessage: 'People will see your initials instead.',
      updated: 'Profile photo updated',
      removed: 'Profile photo removed',
    },
  });
  if (!me) return null;
  const badge = Math.max(36, Math.round(size * 0.27));
  return (
    <View style={{ width: size, height: size }}>
      <Press
        ref={e.ref}
        feedback={false}
        accessibilityLabel={me.avatarUrl ? 'Change profile photo' : 'Add profile photo'}
        onPress={() => void e.open()}
        style={tw`rounded-full`}
      >
        <Avatar
          src={me.avatarUrl}
          animatedSrc={me.avatarAnimatedUrl}
          name={me.displayName}
          colorSeed={me.id}
          size={size}
        />
        {e.busy ? (
          <View style={tw`absolute inset-0 items-center justify-center rounded-full bg-black/50`}>
            <Spinner size={28} color="#ffffff" />
          </View>
        ) : null}
      </Press>
      <View
        pointerEvents="none"
        style={[
          tw`absolute items-center justify-center rounded-full bg-brand`,
          {
            right: size * 0.02 - 4,
            bottom: size * 0.02 - 4,
            width: badge + 8,
            height: badge + 8,
            borderWidth: 4,
            borderColor: c.surface,
          },
          shadow.sm,
        ]}
      >
        <Icon
          icon={Camera}
          size={Math.round(badge * 0.48)}
          color={c['on-brand']}
          strokeWidth={ICON_STROKE_ON_FILL}
        />
      </View>
      <Menu
        open={e.menuOpen}
        onClose={() => e.setMenuOpen(false)}
        anchor={e.anchor}
        items={e.items}
        align="start"
      />
      <PhotoViewer
        open={e.viewing}
        onClose={() => e.setViewing(false)}
        src={me.avatarUrl}
        animatedSrc={me.avatarAnimatedUrl}
        title={me.displayName}
        subtitle="Profile photo"
      />
    </View>
  );
}

export function BannerEditor() {
  const { tw, c, shadow } = useTheme();
  const me = useMe();
  const e = useMediaEditor({
    has: !!me?.bannerUrl,
    change: () => changeBanner(),
    remove: removeBanner,
    labels: {
      view: 'View banner',
      upload: 'Upload banner',
      uploadNew: 'Upload new banner',
      remove: 'Remove banner',
      removeTitle: 'Remove banner?',
      removeMessage: 'Your profile will show your profile colour instead.',
      updated: 'Banner updated',
      removed: 'Banner removed',
    },
  });
  if (!me) return null;
  return (
    <View style={[tw`w-full overflow-hidden rounded-2xl`, { aspectRatio: 5 / 2 }]}>
      <Press
        ref={e.ref}
        feedback={false}
        accessibilityLabel={me.bannerUrl ? 'Change banner' : 'Add banner'}
        onPress={() => void e.open()}
        style={[tw`absolute inset-0`, { backgroundColor: me.profileColor ?? c.brand }]}
      >
        {me.bannerUrl ? (
          <Image
            source={{ uri: mediaUrl(me.bannerUrl) }}
            style={tw`size-full`}
            contentFit="cover"
          />
        ) : null}
        {e.busy ? (
          <View style={tw`absolute inset-0 items-center justify-center bg-black/50`}>
            <Spinner size={28} color="#ffffff" />
          </View>
        ) : null}
      </Press>
      <View
        pointerEvents="none"
        style={[
          tw`absolute right-2 bottom-2 size-11 items-center justify-center rounded-full bg-brand`,
          { borderWidth: 4, borderColor: c.surface },
          shadow.sm,
        ]}
      >
        <Icon icon={Camera} size={18} color={c['on-brand']} strokeWidth={ICON_STROKE_ON_FILL} />
      </View>
      <Menu
        open={e.menuOpen}
        onClose={() => e.setMenuOpen(false)}
        anchor={e.anchor}
        items={e.items}
        align="end"
      />
      <PhotoViewer
        open={e.viewing}
        onClose={() => e.setViewing(false)}
        src={me.bannerUrl}
        animatedSrc={me.bannerAnimatedUrl}
        title={me.displayName}
        subtitle="Profile banner"
        banner
      />
    </View>
  );
}
