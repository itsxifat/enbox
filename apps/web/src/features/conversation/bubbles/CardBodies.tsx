/** Document, location, contact-card and call bubble contents. */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowDownToLine,
  ExternalLink,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  MapPin,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  UserPlus,
  Video,
} from 'lucide-react';
import {
  callOutcome,
  formatBytes,
  formatDuration,
  type ChatSummary,
  type Contact,
} from '@enbox/shared';
import { Avatar } from '@/components/ui';
import { api, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import type { ClientMessage } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { useUser, useUsers } from '@/stores/users';
import { openDirectChat } from '../actions';
import { ProgressRing } from './MediaBody';
import { cancelUpload } from '../lib/sendMedia';

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function extOf(name: string | null, mime: string): string {
  const m = name ? /\.([a-z0-9]{1,6})$/i.exec(name) : null;
  if (m) return m[1]!.toUpperCase();
  const sub = mime.split('/')[1] ?? 'file';
  return sub.replace(/^x-/, '').slice(0, 6).toUpperCase();
}

function fileIcon(mime: string, ext: string) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (/zip|rar|7z|tar|gz/i.test(ext)) return FileArchive;
  if (/xls|csv|numbers|ods/i.test(ext)) return FileSpreadsheet;
  return FileText;
}

const EXT_COLORS: Record<string, string> = {
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

export function FileBody({ m, mine }: { m: ClientMessage; mine: boolean }) {
  const media = m.media!;
  const ext = extOf(media.fileName, media.mimeType);
  const Icon = fileIcon(media.mimeType, ext);
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const href = mediaUrl(m.localUrl ?? media.url);
  return (
    <div className="flex w-[min(300px,70vw)] items-center gap-3 rounded-lg bg-black/[0.05] p-2.5 dark:bg-white/[0.07]">
      <span
        className="relative flex h-12 w-10 shrink-0 items-end justify-center rounded-md pb-1 text-[9px] font-bold text-white"
        style={{ backgroundColor: EXT_COLORS[ext] ?? 'var(--brand)' }}
        aria-hidden
      >
        <Icon size={18} className="absolute top-1.5" />
        {ext.slice(0, 4)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-[14px] font-medium break-all">
          {media.fileName ?? 'Document'}
        </span>
        <span className={cn('text-[12px]', mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta')}>
          {formatBytes(media.size)} · {ext}
        </span>
      </span>
      {uploading ? (
        <span className="shrink-0 scale-[0.8]">
          <ProgressRing
            value={m.uploadProgress ?? 0}
            onCancel={m.clientId ? () => cancelUpload(m.clientId!) : undefined}
          />
        </span>
      ) : href && !m.pending ? (
        <a
          href={href}
          download={media.fileName ?? true}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Download ${media.fileName ?? 'document'}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-current/20 text-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/10"
        >
          <ArrowDownToLine size={18} aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/** Slippy-map tile containing a coordinate (OpenStreetMap). */
export function osmTile(
  lat: number,
  lon: number,
  zoom = 15,
): { x: number; y: number; z: number; fx: number; fy: number } {
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

export function mapsUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

export function MapPreview({
  lat,
  lon,
  className,
}: {
  lat: number;
  lon: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const t = osmTile(lat, lon);
  return (
    <span
      className={cn('relative block overflow-hidden bg-[#e8e4da] dark:bg-[#2a2d33]', className)}
    >
      {/* Offline-safe fallback: stylised streets. */}
      <svg
        className="absolute inset-0 size-full opacity-60"
        viewBox="0 0 300 150"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <path
          d="M-10 110 C60 90 120 120 180 80 S280 40 320 60"
          stroke="#fff"
          strokeWidth="10"
          fill="none"
          opacity=".8"
        />
        <path
          d="M40 -10 L90 160 M200 -10 L170 160 M-10 40 L320 30"
          stroke="#fff"
          strokeWidth="5"
          fill="none"
          opacity=".7"
        />
        <circle cx="240" cy="110" r="26" fill="#b7d9a8" opacity=".7" />
        <rect x="20" y="10" width="50" height="30" rx="6" fill="#d6d0c4" />
        <rect x="110" y="95" width="45" height="40" rx="6" fill="#d6d0c4" />
      </svg>
      {!failed ? (
        <img
          src={`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`}
          alt=""
          aria-hidden
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFailed(true)}
          className="absolute size-[256px] max-w-none"
          style={{ left: `calc(50% - ${t.fx * 256}px)`, top: `calc(50% - ${t.fy * 256}px)` }}
        />
      ) : null}
      <MapPin
        size={34}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full fill-danger text-white drop-shadow-md"
        aria-hidden
      />
    </span>
  );
}

export function LocationBody({ m, rounded }: { m: ClientMessage; rounded: string }) {
  const loc = m.location!;
  const url = mapsUrl(loc.latitude, loc.longitude);
  return (
    <div className="flex w-[min(300px,70vw)] flex-col">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Open ${loc.name ?? 'location'} in maps`}
        className={cn('block overflow-hidden', rounded)}
      >
        <MapPreview lat={loc.latitude} lon={loc.longitude} className="h-36 w-full" />
      </a>
      <div className="flex items-start gap-2 px-1.5 pt-2 pb-0.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{loc.name ?? 'Shared location'}</p>
          <p className="line-clamp-2 text-[12px] text-muted">
            {loc.address ?? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-brand-ink hover:bg-black/5 dark:hover:bg-white/10"
        >
          Open <ExternalLink size={12} aria-hidden />
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contact card
// ---------------------------------------------------------------------------

export function ContactBody({ m }: { m: ClientMessage }) {
  const card = m.contact!;
  const me = useAuth((s) => s.user?.id);
  const user = useUser(card.userId);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const isMe = card.userId === me;
  const linked = !!card.userId && !user?.isDeleted;

  const add = async () => {
    if (!card.userId) return;
    setAdding(true);
    try {
      const c = await api.post<Contact>('/api/contacts', { userId: card.userId });
      useUsers.getState().upsertUsers([c.user]);
      toast.success(`${card.name} added to contacts`);
    } catch (e) {
      toast.error(e);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex w-[min(280px,70vw)] flex-col">
      <div className="flex items-center gap-3 px-1 py-2">
        <Avatar
          src={user?.avatarUrl}
          name={card.name}
          colorSeed={card.userId ?? card.name}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{card.name}</p>
          <p className="truncate text-[12px] text-muted">
            {card.username ? `@${card.username}` : null}
            {card.username && card.phone ? ' · ' : null}
            {card.phone}
          </p>
        </div>
      </div>
      {linked && !isMe ? (
        <div className="-mx-2.5 mt-1 flex border-t border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void openDirectChat(card.userId!).then((id) => id && navigate(`/chats/${id}`));
            }}
            className="flex-1 py-2.5 text-[14px] font-semibold text-brand-ink hover:bg-black/5 dark:hover:bg-white/5"
          >
            Message
          </button>
          {user && !user.isContact ? (
            <button
              type="button"
              disabled={adding}
              onClick={(e) => {
                e.stopPropagation();
                void add();
              }}
              className="flex flex-1 items-center justify-center gap-1.5 border-l border-black/10 py-2.5 text-[14px] font-semibold text-brand-ink hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
            >
              <UserPlus size={15} aria-hidden /> Add contact
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call messages
// ---------------------------------------------------------------------------

export function callTitle(
  m: ClientMessage,
  meId: string | undefined,
): { title: string; missed: boolean; outgoing: boolean; ongoing: boolean } {
  const call = m.call!;
  const { direction, outcome } = callOutcome(call, meId);
  const kind = call.callType === 'video' ? 'video call' : 'voice call';
  const Kind = call.isGroup ? `Group ${kind}` : kind[0]!.toUpperCase() + kind.slice(1);
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

export function CallBody({
  m,
  chat,
  meta,
}: {
  m: ClientMessage;
  chat: ChatSummary;
  meta?: ReactNode;
}) {
  const me = useAuth((s) => s.user?.id);
  const call = m.call!;
  const info = callTitle(m, me);
  const { outcome } = callOutcome(call, me);
  const Icon =
    call.callType === 'video'
      ? Video
      : info.missed
        ? PhoneMissed
        : info.ongoing
          ? Phone
          : info.outgoing
            ? PhoneOutgoing
            : PhoneIncoming;
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
  const action = () => void useCalls.getState().startCall(chat.id, call.callType);
  return (
    <div className="flex w-[min(260px,70vw)] flex-col">
      <button
        type="button"
        disabled={!canCall}
        onClick={(e) => {
          e.stopPropagation();
          action();
        }}
        className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-left enabled:hover:bg-black/5 disabled:cursor-default dark:enabled:hover:bg-white/5"
        aria-label={canCall ? `${info.title}. ${info.ongoing ? 'Join' : 'Call back'}` : info.title}
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            info.missed ? 'bg-danger-soft text-danger' : 'bg-black/[0.06] text-fg dark:bg-white/10',
          )}
        >
          <Icon size={20} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-medium">{info.title}</span>
          <span className="flex items-center gap-3 text-[12px] text-muted">
            {sub ? <span className="truncate">{sub}</span> : null}
            {meta ? <span className="ml-auto shrink-0">{meta}</span> : null}
          </span>
        </span>
      </button>
    </div>
  );
}
