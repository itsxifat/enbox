/** Document, location, contact-card and call bubble contents (web bubbles/CardBodies.tsx). */
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ArrowDownToLine,
  ExternalLink,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Map as MapIcon,
  MapPin,
  UserPlus,
} from 'lucide-react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { callOutcome, formatBytes, formatDuration } from '@enbox/shared';
import {
  Icon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneMissedIcon,
  PhoneOutgoingIcon,
  VideoIcon,
} from '@/components/icons';
import { Avatar, Press, T, toast } from '@/components/ui';
import { api, mediaUrl } from '@/lib/api';
import { openFile } from '@/lib/files';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useUser, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { openDirectChat } from '../actions';
import { cancelUpload } from '../lib/sendMedia';
import { ProgressRing } from './MediaBody';
import { tileKey, useTileRevealed } from './mapTiles';

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function extOf(name, mime) {
  const m = name ? /\.([a-z0-9]{1,6})$/i.exec(name) : null;
  if (m) return m[1].toUpperCase();
  const sub = mime.split('/')[1] ?? 'file';
  return sub.replace(/^x-/, '').slice(0, 6).toUpperCase();
}

function fileIcon(mime, ext) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (/zip|rar|7z|tar|gz/i.test(ext)) return FileArchive;
  if (/xls|csv|numbers|ods/i.test(ext)) return FileSpreadsheet;
  return FileText;
}

const EXT_COLORS = {
  PDF: '#e5484d',
  DOC: '#2f6fed',
  DOCX: '#2f6fed',
  XLS: '#16a34a',
  XLSX: '#16a34a',
  CSV: '#16a34a',
  PPT: '#f76b15',
  PPTX: '#f76b15',
  ZIP: '#8e8c9d',
};

function cardBg(dark) {
  return dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
}

export function FileBody({ m, mine, width }) {
  const { tw, c, dark } = useTheme();
  const media = m.media;
  const ext = extOf(media.fileName, media.mimeType);
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const href = mediaUrl(m.localUrl ?? media.url);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (!href || busy) return;
    setBusy(true);
    try {
      await openFile(href, media.fileName ?? 'document', media.mimeType);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Press
      onPress={() => void open()}
      disabled={!href || !!m.pending}
      style={[
        tw`flex-row items-center gap-3 rounded-lg p-2.5`,
        { width: Math.min(300, width ?? 300), backgroundColor: cardBg(dark) },
      ]}
    >
      <View
        style={[
          tw`h-12 w-10 items-center justify-end rounded-md pb-1`,
          { backgroundColor: EXT_COLORS[ext] ?? c.brand },
        ]}
      >
        <View style={tw`absolute top-1.5`}>
          <Icon icon={fileIcon(media.mimeType, ext)} size={18} color="#fff" />
        </View>
        <T style={tw`text-[9px] font-bold text-white`}>{ext.slice(0, 4)}</T>
      </View>
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={2} style={tw`text-[14px] font-medium`}>
          {media.fileName ?? 'Document'}
        </T>
        <T style={[tw`text-[12px]`, { color: mine ? c['bubble-out-meta'] : c['bubble-in-meta'] }]}>
          {formatBytes(media.size)} · {ext}
        </T>
      </View>
      {uploading ? (
        <View style={{ transform: [{ scale: 0.8 }] }}>
          <ProgressRing
            value={m.uploadProgress}
            onCancel={m.clientId ? () => cancelUpload(m.clientId) : undefined}
          />
        </View>
      ) : href && !m.pending ? (
        <View
          style={[
            tw`size-9 items-center justify-center rounded-full border`,
            { borderColor: 'rgba(128,128,140,0.25)' },
          ]}
        >
          <Icon icon={ArrowDownToLine} size={18} color={c.muted} />
        </View>
      ) : null}
    </Press>
  );
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export function osmTile(lat, lon, zoom = 15) {
  const n = 2 ** zoom;
  const xf = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    x: Math.floor(xf),
    y: Math.floor(yf),
    z: zoom,
    fx: xf - Math.floor(xf),
    fy: yf - Math.floor(yf),
  };
}

export function mapsUrl(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

/** Stylised streets; the OpenStreetMap tile only after "Show map" (privacy, see mapTiles). */
export function MapPreview({ lat, lon, height = 144, style }) {
  const { c, dark } = useTheme();
  const [failed, setFailed] = useState(false);
  const [w, setW] = useState(0);
  const t = osmTile(lat, lon);
  const [revealed] = useTileRevealed(tileKey(t));
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ height, overflow: 'hidden', backgroundColor: dark ? '#2a2d33' : '#e8e4da' }, style]}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 300 150"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: 0.6, position: 'absolute' }}
      >
        <Path
          d="M-10 110 C60 90 120 120 180 80 S280 40 320 60"
          stroke="#fff"
          strokeWidth="10"
          fill="none"
          opacity={0.8}
        />
        <Path
          d="M40 -10 L90 160 M200 -10 L170 160 M-10 40 L320 30"
          stroke="#fff"
          strokeWidth="5"
          fill="none"
          opacity={0.7}
        />
        <Circle cx="240" cy="110" r="26" fill="#b7d9a8" opacity={0.7} />
        <Rect x="20" y="10" width="50" height="30" rx="6" fill="#d6d0c4" />
        <Rect x="110" y="95" width="45" height="40" rx="6" fill="#d6d0c4" />
      </Svg>
      {revealed && !failed && w ? (
        <Image
          source={{ uri: `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png` }}
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            width: 256,
            height: 256,
            left: w / 2 - t.fx * 256,
            top: height / 2 - t.fy * 256,
          }}
        />
      ) : null}
      <View
        style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -17, marginTop: -34 }}
      >
        <MapPin size={34} color="#fff" fill={c.danger} strokeWidth={2} />
      </View>
    </View>
  );
}

export function ShowMapButton({ lat, lon, style }) {
  const { tw } = useTheme();
  const [revealed, reveal] = useTileRevealed(tileKey(osmTile(lat, lon)));
  if (revealed) return null;
  return (
    <Press
      onPress={reveal}
      style={[tw`flex-row items-center gap-1 rounded-full bg-black/55 px-2.5 py-1`, style]}
      pressedStyle={tw`bg-black/70`}
    >
      <Icon icon={MapIcon} size={14} color="#fff" />
      <T style={tw`text-[12px] font-semibold text-white`}>Show map</T>
    </Press>
  );
}

export function LocationBody({ m, radius = 6, width }) {
  const { tw, c } = useTheme();
  const loc = m.location;
  const url = mapsUrl(loc.latitude, loc.longitude);
  const open = () => void Linking.openURL(url).catch(() => undefined);
  return (
    <View style={{ width: Math.min(300, width ?? 300) }}>
      <View style={{ borderRadius: radius, overflow: 'hidden' }}>
        <Press onPress={open} feedback={false}>
          <MapPreview lat={loc.latitude} lon={loc.longitude} />
        </Press>
        <ShowMapButton
          lat={loc.latitude}
          lon={loc.longitude}
          style={tw`absolute right-2 bottom-2`}
        />
      </View>
      <View style={tw`flex-row items-start gap-2 px-1.5 pt-2 pb-0.5`}>
        <View style={tw`min-w-0 flex-1`}>
          <T numberOfLines={1} style={tw`text-[14px] font-medium`}>
            {loc.name ?? 'Shared location'}
          </T>
          <T numberOfLines={2} style={tw`text-[12px] text-muted`}>
            {loc.address ?? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}
          </T>
        </View>
        <Press onPress={open} style={tw`flex-row items-center gap-1 rounded-full px-2 py-1`}>
          <T style={tw`text-[12px] font-semibold text-brand-ink`}>Open</T>
          <Icon icon={ExternalLink} size={12} color={c['brand-ink']} />
        </Press>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Contact card
// ---------------------------------------------------------------------------

export function ContactBody({ m, width }) {
  const { tw, c, dark } = useTheme();
  const card = m.contact;
  const me = useAuth((s) => s.user?.id);
  const user = useUser(card.userId);
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const isMe = card.userId === me;
  const linked = !!card.userId && !user?.isDeleted;
  const divider = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const add = async () => {
    if (!card.userId) return;
    setAdding(true);
    try {
      const contact = await api.post('/api/contacts', { userId: card.userId });
      useUsers.getState().upsertUsers([contact.user]);
      toast.success(`${card.name} added to contacts`);
    } catch (e) {
      toast.error(e);
    } finally {
      setAdding(false);
    }
  };
  return (
    <View style={{ width: Math.min(280, width ?? 280) }}>
      <View style={tw`flex-row items-center gap-3 px-1 py-2`}>
        <Avatar
          src={user?.avatarUrl}
          name={card.name}
          colorSeed={card.userId ?? card.name}
          size="lg"
        />
        <View style={tw`min-w-0 flex-1`}>
          <T numberOfLines={1} style={tw`text-[15px] font-semibold`}>
            {card.name}
          </T>
          <T numberOfLines={1} style={tw`text-[12px] text-muted`}>
            {card.username ? `@${card.username}` : null}
            {card.username && card.phone ? ' · ' : null}
            {card.phone}
          </T>
        </View>
      </View>
      {linked && !isMe ? (
        <View style={[tw`-mx-2.5 mt-1 flex-row border-t`, { borderColor: divider }]}>
          <Press
            onPress={() =>
              void openDirectChat(card.userId).then((id) => id && router.push(`/chats/${id}`))
            }
            style={tw`flex-1 items-center py-2.5`}
          >
            <T style={tw`text-[14px] font-semibold text-brand-ink`}>Message</T>
          </Press>
          {user && !user.isContact ? (
            <Press
              disabled={adding}
              onPress={() => void add()}
              style={[
                tw`flex-1 flex-row items-center justify-center gap-1.5 border-l py-2.5`,
                { borderColor: divider },
              ]}
            >
              <Icon icon={UserPlus} size={16} color={c['brand-ink']} />
              <T style={tw`text-[14px] font-semibold text-brand-ink`}>Add contact</T>
            </Press>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export function callTitle(m, meId) {
  const call = m.call;
  const { direction, outcome } = callOutcome(call, meId);
  const kind = call.callType === 'video' ? 'video call' : 'voice call';
  const Kind = call.isGroup ? `Group ${kind}` : kind[0].toUpperCase() + kind.slice(1);
  switch (outcome) {
    case 'ongoing':
      return {
        title: `${Kind} in progress`,
        missed: false,
        outgoing: direction === 'outgoing',
        ongoing: true,
      };
    case 'missed':
      return {
        title: `Missed ${call.isGroup ? 'group ' : ''}${kind}`,
        missed: true,
        outgoing: false,
        ongoing: false,
      };
    case 'declined':
      return {
        title: direction === 'outgoing' ? `${Kind} declined` : `Declined ${kind}`,
        missed: false,
        outgoing: direction === 'outgoing',
        ongoing: false,
      };
    case 'cancelled':
      return { title: `Cancelled ${kind}`, missed: false, outgoing: true, ongoing: false };
    case 'unanswered':
      return { title: Kind, missed: false, outgoing: true, ongoing: false };
    default:
      return { title: Kind, missed: false, outgoing: direction === 'outgoing', ongoing: false };
  }
}

export function CallBody({ m, chat, meta, width }) {
  const { tw, c, dark } = useTheme();
  const me = useAuth((s) => s.user?.id);
  const call = m.call;
  const info = callTitle(m, me);
  const { outcome } = callOutcome(call, me);
  const CallIcon =
    call.callType === 'video'
      ? VideoIcon
      : info.missed
        ? PhoneMissedIcon
        : info.ongoing
          ? PhoneIcon
          : info.outgoing
            ? PhoneOutgoingIcon
            : PhoneIncomingIcon;
  const sub =
    outcome === 'answered' && call.durationSec
      ? formatDuration(call.durationSec * 1000)
      : outcome === 'unanswered'
        ? 'No answer'
        : info.ongoing
          ? 'Tap to join'
          : info.missed
            ? 'Tap to call back'
            : null;
  const canCall = chat.permissions.canCall && chat.membership === 'active';
  return (
    <Press
      disabled={!canCall}
      onPress={() => void useCalls.getState().startCall(chat.id, call.callType)}
      style={[
        tw`flex-row items-center gap-3 rounded-lg px-1 py-1.5`,
        { width: Math.min(260, width ?? 260) },
      ]}
    >
      <View
        style={[
          tw`size-10 items-center justify-center rounded-full`,
          {
            backgroundColor: info.missed
              ? c['danger-soft']
              : dark
                ? 'rgba(255,255,255,0.1)'
                : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        <Icon icon={CallIcon} size={20} color={info.missed ? c.danger : c.fg} />
      </View>
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[14px] font-medium`}>
          {info.title}
        </T>
        <View style={tw`flex-row items-center gap-3`}>
          {sub ? (
            <T numberOfLines={1} style={tw`shrink text-[12px] text-muted`}>
              {sub}
            </T>
          ) : null}
          {meta ? <View style={tw`ml-auto`}>{meta}</View> : null}
        </View>
      </View>
    </Press>
  );
}
