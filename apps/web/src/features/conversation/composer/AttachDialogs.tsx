/** Attachment dialogs: location, contact card, poll creator, camera capture. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, LocateFixed, MapPin, Plus, RefreshCw, SwitchCamera, Trash2 } from 'lucide-react';
import {
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  locationSchema,
  pollInputSchema,
  userDisplayName,
  type Contact,
  type LocationPayload,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ListItem,
  ListItemSkeleton,
  Modal,
  SearchInput,
  Spinner,
  Switch,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/stores/ui';
import { MapPreview } from '../bubbles/CardBodies';

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

type GeoState =
  | { status: 'locating' }
  | { status: 'ok'; lat: number; lon: number; accuracy: number }
  | { status: 'error'; message: string };

export function LocationDialog({
  open,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (loc: LocationPayload) => void;
}) {
  const [geo, setGeo] = useState<GeoState>({ status: 'locating' });
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', latitude: '', longitude: '' });
  const [error, setError] = useState<string | null>(null);

  const locate = () => {
    if (!navigator.geolocation) {
      setGeo({ status: 'error', message: 'Location is not available in this browser.' });
      setManual(true);
      return;
    }
    setGeo({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setGeo({
          status: 'ok',
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (e) => {
        setGeo({
          status: 'error',
          message:
            e.code === e.PERMISSION_DENIED
              ? 'Location permission was denied.'
              : 'Couldn’t get your location.',
        });
        setManual(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  useEffect(() => {
    if (open) locate();
    else {
      setManual(false);
      setError(null);
    }
  }, [open]);

  const sendManual = () => {
    const parsed = locationSchema.safeParse({
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      name: form.name.trim() || null,
      address: form.address.trim() || null,
    });
    if (!form.latitude || !form.longitude || !parsed.success) {
      setError('Enter a latitude between -90 and 90 and a longitude between -180 and 180.');
      return;
    }
    onSend(parsed.data);
  };

  return (
    <Modal open={open} onClose={onClose} title="Send location" size="sm">
      {!manual ? (
        <div className="flex flex-col gap-3 pb-2">
          <div className="relative h-44 overflow-hidden rounded-2xl">
            {geo.status === 'ok' ? (
              <MapPreview lat={geo.lat} lon={geo.lon} className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center bg-surface-2 text-brand-ink">
                <Spinner size={26} />
              </div>
            )}
          </div>
          <Button
            leftIcon={LocateFixed}
            disabled={geo.status !== 'ok'}
            onClick={() =>
              geo.status === 'ok' &&
              onSend({
                latitude: geo.lat,
                longitude: geo.lon,
                name: 'Current location',
                address: null,
              })
            }
            fullWidth
          >
            {geo.status === 'ok'
              ? `Send current location (±${Math.round(geo.accuracy)} m)`
              : 'Finding your location…'}
          </Button>
          <Button variant="ghost" leftIcon={MapPin} onClick={() => setManual(true)} fullWidth>
            Enter a place manually
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendManual();
          }}
        >
          {geo.status === 'error' ? <p className="text-sm text-muted">{geo.message}</p> : null}
          <Input
            label="Place name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Central Station"
            maxLength={200}
          />
          <Input
            label="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Optional"
            maxLength={500}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Latitude"
              inputMode="decimal"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="48.8584"
              required
            />
            <Input
              label="Longitude"
              inputMode="decimal"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="2.2945"
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            {navigator.geolocation ? (
              <Button
                variant="ghost"
                leftIcon={RefreshCw}
                onClick={() => {
                  setManual(false);
                  locate();
                }}
              >
                Use my location
              </Button>
            ) : null}
            <Button type="submit">Send</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Contact card
// ---------------------------------------------------------------------------

export function ContactPickerDialog({
  open,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (contact: Contact) => void;
}) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    api
      .get<Contact[]>('/api/contacts')
      .then(setContacts)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (contacts ?? []).filter((c) => !c.user.isDeleted);
    const name = (c: Contact) => c.name ?? userDisplayName(c.user);
    return list
      .filter((c) => !q || name(c).toLowerCase().includes(q) || c.user.username.includes(q))
      .sort((a, b) => name(a).localeCompare(name(b)));
  }, [contacts, query]);

  return (
    <Modal open={open} onClose={onClose} title="Share contact" size="sm">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search contacts"
        aria-label="Search contacts"
        autoFocus
      />
      <div className="-mx-6 mt-2 max-h-[50dvh] min-h-32 overflow-y-auto scrollbar-thin">
        {error ? (
          <p className="px-6 py-4 text-sm text-danger">{error}</p>
        ) : !contacts ? (
          <ListItemSkeleton count={4} />
        ) : shown.length ? (
          shown.map((c) => (
            <ListItem
              key={c.user.id}
              dense
              leading={<UserAvatar user={c.user} size="md" />}
              title={c.name ?? userDisplayName(c.user)}
              subtitle={`@${c.user.username}`}
              onClick={() => onSend(c)}
            />
          ))
        ) : (
          <EmptyState
            compact
            title={contacts.length ? 'No matches' : 'No contacts yet'}
            description={
              contacts.length ? 'Try another name.' : 'Add contacts to share them in chats.'
            }
          />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

export function PollDialog({
  open,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (poll: { question: string; options: string[]; allowMultiple: boolean }) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuestion('');
      setOptions(['', '']);
      setMultiple(false);
      setError(null);
    }
  }, [open]);

  const setOption = (i: number, v: string) => {
    setOptions((cur) => {
      const next = cur.map((o, j) => (j === i ? v : o));
      // Keep one empty slot at the end (WhatsApp style).
      if (i === next.length - 1 && v.trim() && next.length < POLL_MAX_OPTIONS) next.push('');
      return next;
    });
  };

  const submit = () => {
    const filled = options.map((o) => o.trim()).filter(Boolean);
    const parsed = pollInputSchema.safeParse({
      question: question.trim(),
      options: filled,
      allowMultiple: multiple,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === 'question'
          ? 'Ask a question'
          : filled.length < 2
            ? 'Add at least 2 options'
            : (issue?.message ?? 'Check the poll'),
      );
      return;
    }
    onSend({
      question: parsed.data.question,
      options: parsed.data.options,
      allowMultiple: parsed.data.allowMultiple,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create poll"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Send poll</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        <Input
          label="Question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question"
          maxLength={POLL_QUESTION_MAX_LENGTH}
          autoFocus
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-fg">Options</legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                aria-label={`Option ${i + 1}`}
                maxLength={POLL_OPTION_MAX_LENGTH}
                containerClassName="flex-1"
              />
              {options.length > 2 && (o || i < options.length - 1) ? (
                <IconButton
                  icon={Trash2}
                  label={`Remove option ${i + 1}`}
                  size="sm"
                  onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
                />
              ) : (
                <span className="size-8" />
              )}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && options[options.length - 1]?.trim() ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Plus}
              onClick={() => setOptions((c) => [...c, ''])}
              className="self-start"
            >
              Add option
            </Button>
          ) : null}
        </fieldset>
        <Switch checked={multiple} onChange={setMultiple} label="Allow multiple answers" />
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export function CameraDialog({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error && e.name === 'NotAllowedError'
            ? 'Camera permission was denied.'
            : 'Couldn’t start the camera.',
        ),
      );
    if (!navigator.mediaDevices) setError('Camera is not available in this browser.');
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, facing]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error('Couldn’t capture the photo');
          return;
        }
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Take photo" size="lg">
      <div className="flex flex-col items-center gap-4 pb-3">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
          {error ? (
            <EmptyState
              icon={Camera}
              title="Camera unavailable"
              description={error}
              className="text-white"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                onLoadedData={() => setReady(true)}
                className="size-full object-cover"
                style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
              />
              {!ready ? (
                <span className="absolute inset-0 flex items-center justify-center text-white">
                  <Spinner size={28} />
                </span>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center gap-6">
          <IconButton
            icon={SwitchCamera}
            label="Switch camera"
            variant="solid"
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
          />
          <button
            type="button"
            aria-label="Capture photo"
            disabled={!ready}
            onClick={capture}
            className="size-16 rounded-full border-4 border-brand bg-surface shadow-elevated transition-transform active:scale-95 disabled:opacity-50"
          />
          <span className="size-10" />
        </div>
      </div>
    </Modal>
  );
}
