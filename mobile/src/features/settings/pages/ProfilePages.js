/**
 * Settings → Profile and its sub-pages (web features/settings/profile/*): card preview,
 * banner, photo, name, pronouns, about, bio, profile colours, username, phone and the share
 * link.
 */
import { useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  AtSign,
  Check,
  CircleUserRound,
  Copy,
  Info,
  Link2,
  Palette,
  Pencil,
  ScrollText,
  Share2,
  Tag,
} from 'lucide-react-native';
import {
  ABOUT_MAX_LENGTH,
  BIO_MAX_LENGTH,
  DEFAULT_ABOUT,
  DISPLAY_NAME_MAX_LENGTH,
  PRONOUNS_MAX_LENGTH,
  hexColorSchema,
} from '@enbox/shared';
import { Icon, PhoneIcon } from '@/components/icons';
import { Button, IconButton, Input, Press, Spinner, T, Textarea, toast } from '@/components/ui';
import { useUsernameAvailability } from '@/features/auth/usernameAvailability';
import { canonicalPhone, normalizeUsernameInput, usernameIssue } from '@/features/auth/validation';
import { selfCardUser } from '@/features/profile/model';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { errorMessage } from '@/lib/api';
import { publicOrigin } from '@/lib/serverConfig';
import { useMe } from '@/stores/auth';
import { useTheme } from '@/theme';
import { EditFieldModal } from '../EditFieldModal';
import { AvatarEditor, BannerEditor } from '../ProfileEditors';
import { ABOUT_PRESETS, updateProfile } from '../settingsApi';
import { SettingsGroup, SettingsRow, SettingsScroller } from '../ui';

/** Public share link for my profile (`/u/<username>`). */
export function profileLink(username) {
  return `${publicOrigin()}/u/${username}`;
}

function Swatch({ color }) {
  const { tw, c } = useTheme();
  return (
    <View
      style={[
        tw`size-3 rounded-full`,
        { backgroundColor: color, borderWidth: 1, borderColor: c['line-strong'] },
      ]}
    />
  );
}

function PreviewCard({ user }) {
  const { tw, c } = useTheme();
  return (
    <View style={tw`p-4`}>
      <ProfileCard
        user={user}
        self
        preview
        style={[tw`rounded-2xl`, { borderWidth: 1, borderColor: c.line }]}
      />
    </View>
  );
}

export function ProfilePage() {
  const { tw, c } = useTheme();
  const me = useMe();
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(false);
  if (!me) return null;
  const link = profileLink(me.username);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link");
    }
  };
  const share = async () => {
    try {
      await Share.share({ title: `${me.displayName} on Enbox`, message: link, url: link });
    } catch {
      /* dismissed */
    }
  };

  const colours =
    me.profileColor || me.accentColor ? (
      <View style={tw`flex-row flex-wrap items-center gap-1.5`}>
        <Swatch color={me.profileColor ?? c.brand} />
        <T style={tw`text-[13.5px] text-muted`}>{me.profileColor ?? 'Default'}</T>
        <T style={tw`text-[13.5px] text-muted`}>·</T>
        <Swatch color={me.accentColor ?? me.profileColor ?? c.brand} />
        <T style={tw`text-[13.5px] text-muted`}>{me.accentColor ?? 'Default'}</T>
      </View>
    ) : (
      'Default'
    );

  return (
    <SettingsScroller>
      <SettingsGroup title="Preview">
        <PreviewCard user={selfCardUser(me)} />
      </SettingsGroup>

      <SettingsGroup
        title="Banner"
        footer="Shown at the top of your profile card. JPEG, PNG, WebP or GIF, cropped to 5:2."
      >
        <View style={tw`p-4`}>
          <BannerEditor />
        </View>
      </SettingsGroup>

      <View style={tw`items-center gap-3 px-6 pt-8 pb-6`}>
        <AvatarEditor size={160} />
        <View style={tw`mt-2 items-center`}>
          <T style={tw`text-center text-[22px] font-semibold`}>{me.displayName}</T>
          <T style={tw`text-[14px] text-muted`}>@{me.username}</T>
        </View>
      </View>

      <SettingsGroup>
        <SettingsRow
          icon={CircleUserRound}
          title="Name"
          description={me.displayName}
          onPress={() => setEditing('name')}
        />
        <SettingsRow
          icon={Tag}
          title="Pronouns"
          description={me.pronouns ?? 'Add your pronouns'}
          to="/settings/profile/pronouns"
        />
        <SettingsRow
          icon={Info}
          title="About"
          description={me.about || 'Add a few words about yourself'}
          to="/settings/profile/about"
        />
        <SettingsRow
          icon={ScrollText}
          title="Bio"
          description={me.bio || 'Tell people about yourself'}
          descriptionLines={2}
          to="/settings/profile/bio"
        />
        <SettingsRow
          icon={Palette}
          title="Profile colours"
          description={colours}
          to="/settings/profile/colours"
        />
        <SettingsRow
          icon={AtSign}
          title="Username"
          description={`@${me.username}`}
          onPress={() => setEditing('username')}
        />
        <SettingsRow
          icon={PhoneIcon}
          title="Phone"
          description={me.phone ?? 'Not added'}
          onPress={() => setEditing('phone')}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Share your profile"
        footer="Anyone with this link can open your profile and start a chat with you on Enbox. What they see follows your privacy settings."
      >
        <SettingsRow
          icon={Link2}
          title={<T style={tw`text-[16px]`}>{link.replace(/^https?:\/\//, '')}</T>}
          chevron={false}
          end={
            <View style={tw`flex-row items-center gap-1`}>
              <IconButton icon={Share2} label="Share link" onPress={() => void share()} />
              <IconButton
                icon={copied ? Check : Copy}
                label="Copy link"
                onPress={() => void copy()}
              />
            </View>
          }
        />
      </SettingsGroup>

      <EditFieldModal
        open={editing === 'name'}
        onClose={() => setEditing(null)}
        title="Edit name"
        label="Your name"
        initialValue={me.displayName}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="name"
        validate={(v) => (v.trim() ? null : "Name can't be empty")}
        onSave={async (v) => {
          await updateProfile({ displayName: v.trim() });
          toast.success('Name updated');
        }}
        hint="This is how you appear to people who haven't saved you as a contact."
      />
      <EditFieldModal
        open={editing === 'username'}
        onClose={() => setEditing(null)}
        title="Edit username"
        label="Username"
        prefix="@"
        initialValue={me.username}
        maxLength={32}
        transform={normalizeUsernameInput}
        validate={(v) => usernameIssue(v) ?? (v ? null : 'Choose a username')}
        status={(v) => <UsernameStatus value={v} current={me.username} />}
        onSave={async (v) => {
          await updateProfile({ username: v });
          toast.success('Username updated');
        }}
      />
      <EditFieldModal
        open={editing === 'phone'}
        onClose={() => setEditing(null)}
        title={me.phone ? 'Change phone number' : 'Add phone number'}
        label="Phone number"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+1 555 123 4567"
        initialValue={me.phone ?? ''}
        validate={(v) =>
          !v.trim() || canonicalPhone(v) ? null : 'Enter a valid phone number with country code'
        }
        hint="Include your country code. Only contacts who saved your number can see it."
        onSave={async (v) => {
          await updateProfile({ phone: v.trim() ? canonicalPhone(v) : null });
          toast.success(v.trim() ? 'Phone number saved' : 'Phone number removed');
        }}
        extraAction={
          me.phone ? (
            <Button
              variant="ghost"
              textStyle={tw`text-danger`}
              onPress={() => {
                void updateProfile({ phone: null })
                  .then(() => {
                    toast.success('Phone number removed');
                    setEditing(null);
                  })
                  .catch((e) => toast.error(e));
              }}
            >
              Remove
            </Button>
          ) : null
        }
      />
    </SettingsScroller>
  );
}

function UsernameStatus({ value, current }) {
  const { tw, c } = useTheme();
  const { state, message } = useUsernameAvailability(value, { current });
  if (state === 'checking')
    return (
      <View style={tw`flex-row items-center gap-1.5`}>
        <Spinner size={12} />
        <T style={tw`text-[13px] text-muted`}>Checking availability…</T>
      </View>
    );
  if (!message)
    return (
      <T style={tw`text-[13px] text-muted`}>Lowercase letters, numbers, dots or underscores.</T>
    );
  return (
    <T
      style={[
        tw`text-[13px]`,
        {
          color:
            state === 'available'
              ? c.success
              : state === 'taken' || state === 'invalid'
                ? c.danger
                : c.muted,
        },
      ]}
    >
      {message}
    </T>
  );
}

export function AboutPage() {
  const { tw, c } = useTheme();
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(null);
  if (!me) return null;

  const choose = async (about) => {
    if (about === me.about) return;
    setSaving(about);
    try {
      await updateProfile({ about });
      toast.success('About updated');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(null);
    }
  };

  const presets = [DEFAULT_ABOUT, ...ABOUT_PRESETS];

  return (
    <SettingsScroller>
      <SettingsGroup title="Currently set to">
        <View style={tw`flex-row items-center gap-3 px-4 py-3.5`}>
          <T style={[tw`min-w-0 flex-1 text-[16px]`, !me.about ? tw`text-muted` : null]}>
            {me.about || 'Nothing yet'}
          </T>
          <IconButton icon={Pencil} label="Edit about" onPress={() => setEditing(true)} />
        </View>
      </SettingsGroup>
      <SettingsGroup title="Select about">
        {presets.map((p) => {
          const selected = p === me.about;
          return (
            <Press
              key={p}
              onPress={() => void choose(p)}
              accessibilityState={{ selected }}
              style={tw`min-h-12 flex-row items-center gap-3 rounded-lg px-4 py-2.5`}
            >
              <T style={tw`min-w-0 flex-1 text-[15.5px]`}>{p}</T>
              {saving === p ? (
                <Spinner size={16} />
              ) : selected ? (
                <Icon icon={Check} size={18} color={c['brand-ink']} />
              ) : null}
            </Press>
          );
        })}
      </SettingsGroup>
      <EditFieldModal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit about"
        label="About"
        initialValue={me.about}
        maxLength={ABOUT_MAX_LENGTH}
        placeholder="Available"
        onSave={async (v) => {
          await updateProfile({ about: v.trim() });
          toast.success('About updated');
        }}
      />
    </SettingsScroller>
  );
}

export function BioPage() {
  const { tw } = useTheme();
  const me = useMe();
  const [value, setValue] = useState(me?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  if (!me) return null;
  const trimmed = value.trim();
  const dirty = trimmed !== me.bio;
  const remaining = Math.max(0, BIO_MAX_LENGTH - Array.from(value).length);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ bio: trimmed });
      toast.success(trimmed ? 'Bio updated' : 'Bio removed');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title="About me"
        footer={`Up to ${BIO_MAX_LENGTH} characters; line breaks are kept. Who can see it follows your About privacy setting.`}
      >
        <View style={tw`gap-3 px-4 py-4`}>
          <Textarea
            accessibilityLabel="Bio"
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(null);
            }}
            maxLength={BIO_MAX_LENGTH}
            minRows={4}
            maxRows={10}
            placeholder="Climber, coffee nerd, always up for a hike."
            error={error ?? undefined}
            hint={`${remaining} characters left`}
          />
          <View style={tw`flex-row justify-end gap-2`}>
            <Button variant="ghost" onPress={() => setValue(me.bio)} disabled={!dirty || saving}>
              Reset
            </Button>
            <Button onPress={() => void save()} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </View>
        </View>
      </SettingsGroup>
      <SettingsGroup title="Preview">
        <PreviewCard user={{ ...selfCardUser(me), bio: trimmed || null }} />
      </SettingsGroup>
    </SettingsScroller>
  );
}

const PRONOUN_SUGGESTIONS = [
  'she/her',
  'he/him',
  'they/them',
  'she/they',
  'he/they',
  'any pronouns',
];

export function PronounsPage() {
  const { tw, c } = useTheme();
  const me = useMe();
  const [value, setValue] = useState(me?.pronouns ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  if (!me) return null;
  const trimmed = value.trim();
  const dirty = trimmed !== (me.pronouns ?? '');

  const save = async (next) => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ pronouns: next || null });
      toast.success(next ? 'Pronouns updated' : 'Pronouns removed');
      setValue(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title="Pronouns"
        footer="Shown next to your username on your profile card. Who can see them follows your About privacy setting."
      >
        <View style={tw`gap-3 px-4 py-4`}>
          <Input
            label="Your pronouns"
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(null);
            }}
            maxLength={PRONOUNS_MAX_LENGTH}
            placeholder="they/them"
            autoComplete="off"
            autoCapitalize="none"
            error={error ?? undefined}
          />
          <View style={tw`flex-row flex-wrap gap-2`}>
            {PRONOUN_SUGGESTIONS.map((s) => {
              const on = trimmed === s;
              return (
                <Press
                  key={s}
                  accessibilityState={{ selected: on }}
                  onPress={() => setValue(s)}
                  style={[
                    tw`rounded-full border px-3 py-1.5`,
                    on
                      ? { borderColor: c.brand, backgroundColor: c['brand-soft'] }
                      : { borderColor: c.line, backgroundColor: c['surface-2'] },
                  ]}
                >
                  <T style={[tw`text-[13.5px]`, on ? tw`text-brand-ink` : null]}>{s}</T>
                </Press>
              );
            })}
          </View>
          <View style={tw`flex-row justify-end gap-2`}>
            {me.pronouns ? (
              <Button
                variant="ghost"
                style={tw`mr-auto`}
                textStyle={tw`text-danger`}
                onPress={() => void save('')}
                disabled={saving}
              >
                Remove
              </Button>
            ) : null}
            <Button onPress={() => void save(trimmed)} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </View>
        </View>
      </SettingsGroup>
    </SettingsScroller>
  );
}

const COLOUR_PRESETS = [
  '#6d5dfc',
  '#0e7fc0',
  '#0f8a6a',
  '#c2410c',
  '#be185d',
  '#7c3aed',
  '#0f766e',
  '#b45309',
];

function parseColour(text) {
  if (!text.trim()) return { value: null, issue: null };
  const r = hexColorSchema.safeParse(text);
  return r.success
    ? { value: r.data, issue: null }
    : { value: null, issue: 'Use a #rrggbb colour' };
}

function normaliseColour(text) {
  return parseColour(text).value ?? text;
}

function ColourField({ label, text, onChange }) {
  const { tw, c } = useTheme();
  const { value, issue } = parseColour(text);
  return (
    <View style={tw`gap-2.5`}>
      <Input
        label={label}
        value={text}
        onChangeText={onChange}
        placeholder="#6d5dfc"
        maxLength={7}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect={false}
        error={issue ?? undefined}
        hint={text ? undefined : 'Default'}
        rightSlot={
          <View
            style={[
              tw`mr-2 size-7 rounded-md`,
              { backgroundColor: value ?? 'transparent', borderWidth: 1, borderColor: c.line },
            ]}
          />
        }
      />
      <View style={tw`flex-row flex-wrap gap-2`}>
        {COLOUR_PRESETS.map((hex) => (
          <Press
            key={hex}
            accessibilityLabel={hex}
            accessibilityState={{ selected: value === hex }}
            onPress={() => onChange(hex)}
            feedback={false}
            style={[
              tw`size-7 rounded-full`,
              {
                backgroundColor: hex,
                boxShadow:
                  value === hex
                    ? `0px 0px 0px 2px ${c.surface}, 0px 0px 0px 4px ${c.brand}`
                    : undefined,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export function ColoursPage() {
  const { tw } = useTheme();
  const me = useMe();
  const [profileText, setProfileText] = useState(me?.profileColor ?? '');
  const [accentText, setAccentText] = useState(me?.accentColor ?? '');
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const profile = parseColour(profileText);
  const accent = parseColour(accentText);
  const invalid = !!(profile.issue || accent.issue);
  const dirty = profile.value !== me.profileColor || accent.value !== me.accentColor;

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ profileColor: profile.value, accentColor: accent.value });
      toast.success('Colours updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup title="Preview">
        <PreviewCard
          user={{ ...selfCardUser(me), profileColor: profile.value, accentColor: accent.value }}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Colours"
        footer="The profile colour fills the top of your card when you have no banner; the accent colour completes the gradient and underlines a banner. Who can see them follows your About privacy setting."
      >
        <View style={tw`gap-5 px-4 py-4`}>
          <ColourField
            label="Profile colour"
            text={profileText}
            onChange={(t) => setProfileText(normaliseColour(t))}
          />
          <ColourField
            label="Accent colour"
            text={accentText}
            onChange={(t) => setAccentText(normaliseColour(t))}
          />
          <View style={tw`flex-row justify-end gap-2`}>
            <Button
              variant="ghost"
              onPress={() => {
                setProfileText('');
                setAccentText('');
              }}
              disabled={saving || (!profileText && !accentText)}
            >
              Use default
            </Button>
            <Button onPress={() => void save()} loading={saving} disabled={!dirty || invalid}>
              Save
            </Button>
          </View>
        </View>
      </SettingsGroup>
    </SettingsScroller>
  );
}
