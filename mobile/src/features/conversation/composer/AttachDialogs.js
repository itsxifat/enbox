/** Location, contact-card and poll attachments (web composer/AttachDialogs.tsx). */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Location from 'expo-location';
import { LocateFixed, MapPin, Plus, Search, X } from 'lucide-react-native';
import { POLL_MAX_OPTIONS, locationSchema, pollInputSchema, userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ListItem,
  Modal,
  SearchInput,
  Spinner,
  Switch,
  T,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useTheme } from '@/theme';
import { MapPreview, ShowMapButton } from '../bubbles/CardBodies';

export function LocationDialog({ open, onClose, onSend }) {
  const { tw } = useTheme();
  const [geo, setGeo] = useState({ status: 'locating' });
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', latitude: '', longitude: '' });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) {
      setManual(false);
      setError(null);
      return;
    }
    let alive = true;
    setGeo({ status: 'locating' });
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) throw Object.assign(new Error('denied'), { denied: true });
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!alive) return;
        setGeo({
          status: 'ok',
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy ?? 0,
        });
      } catch (e) {
        if (!alive) return;
        setGeo({
          status: 'error',
          message: e?.denied ? 'Location permission was denied.' : 'Couldn’t get your location.',
        });
        setManual(true);
      }
    })();
    return () => {
      alive = false;
    };
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
    <Modal open={open} onClose={onClose} title="Send location">
      {!manual ? (
        <View style={tw`gap-3 pb-2`}>
          <View style={tw`h-44 overflow-hidden rounded-2xl`}>
            {geo.status === 'ok' ? (
              <>
                <MapPreview lat={geo.lat} lon={geo.lon} height={176} />
                <ShowMapButton lat={geo.lat} lon={geo.lon} style={tw`absolute right-2 bottom-2`} />
              </>
            ) : (
              <View style={tw`h-full items-center justify-center bg-surface-2`}>
                <Spinner size={26} />
              </View>
            )}
          </View>
          <Button
            leftIcon={LocateFixed}
            disabled={geo.status !== 'ok'}
            fullWidth
            onPress={() =>
              geo.status === 'ok' &&
              onSend({
                latitude: geo.lat,
                longitude: geo.lon,
                name: 'Current location',
                address: null,
              })
            }
          >
            {geo.status === 'ok'
              ? `Send current location (±${Math.round(geo.accuracy)} m)`
              : 'Finding your location…'}
          </Button>
          <Button variant="ghost" leftIcon={MapPin} fullWidth onPress={() => setManual(true)}>
            Enter a place manually
          </Button>
        </View>
      ) : (
        <View style={tw`gap-3 pb-2`}>
          {geo.status === 'error' ? <T style={tw`text-[13px] text-muted`}>{geo.message}</T> : null}
          <Input
            label="Place name"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="e.g. Central Station"
          />
          <Input
            label="Address"
            value={form.address}
            onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
            placeholder="Optional"
          />
          <View style={tw`flex-row gap-3`}>
            <Input
              label="Latitude"
              containerStyle={tw`flex-1`}
              keyboardType="numbers-and-punctuation"
              value={form.latitude}
              onChangeText={(v) => setForm((f) => ({ ...f, latitude: v }))}
              placeholder="48.8584"
            />
            <Input
              label="Longitude"
              containerStyle={tw`flex-1`}
              keyboardType="numbers-and-punctuation"
              value={form.longitude}
              onChangeText={(v) => setForm((f) => ({ ...f, longitude: v }))}
              placeholder="2.2945"
            />
          </View>
          {error ? <T style={tw`text-[13px] text-danger`}>{error}</T> : null}
          <View style={tw`flex-row justify-end gap-2 pt-1`}>
            {geo.status === 'ok' ? (
              <Button variant="ghost" onPress={() => setManual(false)}>
                Back
              </Button>
            ) : null}
            <Button onPress={sendManual}>Send</Button>
          </View>
        </View>
      )}
    </Modal>
  );
}

export function ContactPickerDialog({ open, onClose, onSend }) {
  const { tw } = useTheme();
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    api
      .get('/api/contacts')
      .then(setContacts)
      .catch((e) => setError(errorMessage(e)));
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (contacts ?? []).filter((ct) => !ct.user.isDeleted);
    const name = (ct) => ct.name ?? userDisplayName(ct.user);
    return list
      .filter((ct) => !q || name(ct).toLowerCase().includes(q) || ct.user.username.includes(q))
      .sort((a, b) => name(a).localeCompare(name(b)));
  }, [contacts, query]);

  return (
    <Modal open={open} onClose={onClose} title="Share contact">
      <SearchInput value={query} onChange={setQuery} placeholder="Search contacts" />
      <View style={tw`-mx-6 mt-2 pb-2`}>
        {error ? (
          <T style={tw`px-6 py-3 text-sm text-danger`}>{error}</T>
        ) : !contacts ? (
          <View style={tw`items-center py-6`}>
            <Spinner />
          </View>
        ) : shown.length ? (
          shown.map((ct) => (
            <ListItem
              key={ct.user.id}
              dense
              onPress={() => onSend(ct)}
              leading={<UserAvatar user={ct.user} size="md" />}
              title={ct.name ?? userDisplayName(ct.user)}
              subtitle={`@${ct.user.username}`}
            />
          ))
        ) : (
          <EmptyState
            compact
            icon={Search}
            title={contacts.length ? 'No matches' : 'No contacts yet'}
            description={contacts.length ? undefined : 'Add contacts to share them in chats.'}
          />
        )}
      </View>
    </Modal>
  );
}

export function PollDialog({ open, onClose, onSend }) {
  const { tw, c } = useTheme();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setQuestion('');
      setOptions(['', '']);
      setMultiple(false);
      setError(null);
    }
  }, [open]);

  const setOption = (i, v) => {
    setOptions((cur) => {
      const next = cur.map((o, j) => (j === i ? v : o));
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
    onSend(parsed.data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create poll"
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button onPress={submit}>Send poll</Button>
        </>
      }
    >
      <View style={tw`gap-4`}>
        <Input
          label="Question"
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask a question"
        />
        <View style={tw`gap-2`}>
          <T style={tw`text-sm font-medium`}>Options</T>
          {options.map((o, i) => (
            <View key={i} style={tw`flex-row items-center gap-2`}>
              <Input
                containerStyle={tw`flex-1`}
                value={o}
                onChangeText={(v) => setOption(i, v)}
                placeholder={`Option ${i + 1}`}
              />
              {options.length > 2 && o ? (
                <IconButton
                  icon={X}
                  label={`Remove option ${i + 1}`}
                  size="sm"
                  onPress={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
                />
              ) : null}
            </View>
          ))}
          {options.length < POLL_MAX_OPTIONS && options[options.length - 1]?.trim() ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Plus}
              onPress={() => setOptions((cur) => [...cur, ''])}
            >
              Add option
            </Button>
          ) : null}
        </View>
        <Switch checked={multiple} onChange={setMultiple} label="Allow multiple answers" />
        {error ? <T style={[tw`text-[13px]`, { color: c.danger }]}>{error}</T> : null}
      </View>
    </Modal>
  );
}
