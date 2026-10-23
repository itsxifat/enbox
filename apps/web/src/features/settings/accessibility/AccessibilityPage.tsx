/**
 * Settings ▸ Accessibility: saturation, contrast, link underlines, role colours, motion
 * (reduced motion, animated emoji, GIFs and avatars, stickers, super reactions), the send
 * button and message spacing. Device prefs (stores/ui.ts), applied on <html> by
 * applyAppearance; the chat text size and text-to-speech stay in Settings ▸ Chats.
 */
import { useId, type ReactNode } from 'react';
import {
  CaseSensitive,
  ImagePlay,
  PartyPopper,
  Palette,
  Rows3,
  SendHorizontal,
  Sparkles,
  Sticker,
  Underline,
  Wind,
} from 'lucide-react';
import { StyledName, type RoleNameStyle } from '@/components/cosmetics';
import { RadioGroup, type IconType } from '@/components/ui';
import { Segmented } from '@/features/appearance/pickers';
import { cn } from '@/lib/cn';
import {
  FONT_SIZES,
  MESSAGE_GROUP_SPACINGS,
  useUi,
  type DevicePrefs,
  type MessageGroupSpacing,
} from '@/stores/ui';
import { SettingsGroup, SettingsRow, SettingsScroller, SwitchRow } from '../ui';

function setPref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void {
  useUi.getState().setPref(key, value);
}

/** The colours of the preview strip: theme tokens, so they follow the slider live. */
const SWATCHES = [
  'bg-brand',
  'bg-link',
  'bg-online',
  'bg-idle',
  'bg-dnd',
  'bg-success',
  'bg-warning',
  'bg-danger',
] as const;

const PREVIEW_ROLE: RoleNameStyle = { color: '#e0529c' };

function SaturationPreview() {
  return (
    <div
      className="mx-3 mt-3 flex flex-col gap-3 rounded-xl bg-surface p-3 lg:mx-4"
      aria-hidden
      data-testid="saturation-preview"
    >
      <div className="flex gap-1.5">
        {SWATCHES.map((c) => (
          <span key={c} className={cn('h-6 min-w-0 flex-1 rounded-md', c)} />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-fg">
        <StyledName
          name="Role colour"
          role={PREVIEW_ROLE}
          roleDisplay="names"
          className="font-semibold"
        />
        <span className="rounded-[3px] bg-brand/20 px-0.5 font-medium text-brand-ink">
          @mention
        </span>
        <span className="text-link">Link</span>
      </p>
    </div>
  );
}

function SaturationSlider({ value }: { value: number }) {
  const id = useId();
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-2 rounded-lg px-3 py-3 lg:px-4">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[16px] text-fg">
          Saturation
        </label>
        <span className="text-[14px] text-muted tabular-nums" aria-hidden>
          {percent}%
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-valuetext={`${percent}%`}
        aria-describedby={`${id}-desc`}
        onChange={(e) => setPref('saturation', Number(e.target.value) / 100)}
        className="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
      />
      <p id={`${id}-desc`} className="text-[13.5px] leading-snug text-muted">
        Tone down the colours of Enbox. Pictures and videos never change.
      </p>
    </div>
  );
}

/** A titled control inside a group: [icon] title / description, then the control under the text. */
function ChoiceRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon?: IconType;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg px-3 py-3 lg:px-4">
      <div className="flex items-center gap-4">
        {Icon ? <Icon size={22} className="shrink-0 text-muted" aria-hidden /> : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[16px] leading-snug text-fg">{title}</span>
          {description ? (
            <span className="text-[13.5px] leading-snug text-muted">{description}</span>
          ) : null}
        </div>
      </div>
      <div className={Icon ? 'pl-[38px]' : undefined}>{children}</div>
    </div>
  );
}

/** Two sender groups, spaced like message rows (`msg-group-start-cozy`, index.css). */
function SpacingPreview() {
  return (
    <div
      className="mx-3 mt-3 rounded-xl bg-surface py-2 lg:mx-4"
      aria-hidden
      data-testid="spacing-preview"
    >
      {['bg-brand/70', 'bg-success/70'].map((avatar, i) => (
        <div
          key={avatar}
          className={cn('flex items-start gap-3 px-3 pt-0.5', i > 0 && 'msg-group-start-cozy')}
        >
          <span className={cn('size-8 shrink-0 rounded-full', avatar)} />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
            <span className="h-2.5 w-20 rounded-full bg-fg/25" />
            <span className="h-2 w-4/5 rounded-full bg-fg/10" />
            <span className="h-2 w-3/5 rounded-full bg-fg/10" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function AccessibilityPage() {
  const prefs = useUi((s) => s.prefs);
  return (
    <SettingsScroller>
      <SettingsGroup title="Saturation">
        <SaturationPreview />
        <SaturationSlider value={prefs.saturation} />
        <SwitchRow
          icon={Palette}
          title="Apply saturation to role colours"
          description="Role colours and the colours people pick for their names follow it too"
          checked={prefs.saturateRoleColors}
          onChange={(v) => setPref('saturateRoleColors', v)}
        />
      </SettingsGroup>

      <SettingsGroup title="Contrast">
        <RadioGroup
          aria-label="Contrast"
          value={prefs.contrast}
          onChange={(v) => setPref('contrast', v)}
          className="px-3 py-1 lg:px-4"
          options={[
            {
              value: 'system',
              label: 'Sync with computer',
              description: 'High contrast whenever your device asks for more contrast',
            },
            { value: 'on', label: 'On', description: 'Stronger text, lines and focus rings' },
            { value: 'off', label: 'Off', description: 'The standard colours' },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup title="Links">
        <SwitchRow
          icon={Underline}
          title="Always underline links"
          description="Links in messages stand out without relying on their colour"
          checked={prefs.underlineLinks}
          onChange={(v) => setPref('underlineLinks', v)}
        />
      </SettingsGroup>

      <SettingsGroup title="Role colours" footer="Only names in Spaces have role colours.">
        <div
          className="mx-3 mt-3 flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-[15px] font-semibold lg:mx-4"
          aria-hidden
          data-testid="role-colors-preview"
        >
          <StyledName name="Robin" role={PREVIEW_ROLE} className="truncate" />
        </div>
        <RadioGroup
          aria-label="Role colours"
          value={prefs.roleColors}
          onChange={(v) => setPref('roleColors', v)}
          className="px-3 py-1 lg:px-4"
          options={[
            {
              value: 'names',
              label: 'Show in names',
              description: 'Names in the colour of their top role',
            },
            {
              value: 'dot',
              label: 'Show next to names',
              description: "Names in the default colour, with a dot in the role's colour",
            },
            {
              value: 'hidden',
              label: "Don't show",
              description: 'Every name in the default colour',
            },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Motion"
        footer="Reduced motion also keeps animated emoji, GIFs, stickers and avatars still."
      >
        <ChoiceRow
          icon={Wind}
          title="Reduced motion"
          description="Fewer and gentler animations across Enbox"
        >
          <RadioGroup
            aria-label="Reduced motion"
            value={prefs.reduceMotion}
            onChange={(v) => setPref('reduceMotion', v)}
            options={[
              {
                value: 'system',
                label: 'Sync with computer',
                description: "Follow your device's reduced motion setting",
              },
              { value: 'on', label: 'On', description: 'Whatever your device is set to' },
              {
                value: 'off',
                label: 'Off',
                description: 'Even when your device asks for less motion',
              },
            ]}
          />
        </ChoiceRow>
        <SwitchRow
          icon={Sparkles}
          title="Play animated emoji"
          description="Off shows animated custom emoji as still pictures"
          checked={prefs.animateEmoji}
          onChange={(v) => setPref('animateEmoji', v)}
        />
        <ChoiceRow
          icon={ImagePlay}
          title="Play GIFs and animated avatars"
          description="GIFs, animated profile pictures and decorations, and animated wallpapers"
        >
          <Segmented
            aria-label="Play GIFs and animated avatars"
            value={prefs.autoplayAnimatedMedia}
            onChange={(v) => setPref('autoplayAnimatedMedia', v)}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'hover', label: 'On hover' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </ChoiceRow>
        <ChoiceRow
          icon={Sticker}
          title="Sticker animations"
          description="When animated stickers move"
        >
          <Segmented
            aria-label="Sticker animations"
            value={prefs.stickerAnimation}
            onChange={(v) => setPref('stickerAnimation', v)}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'interaction', label: 'On hover' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </ChoiceRow>
        <SwitchRow
          icon={PartyPopper}
          title="Play super reaction animations"
          description="The burst around a super reaction when it's added"
          checked={prefs.superReactionAnimations}
          onChange={(v) => setPref('superReactionAnimations', v)}
        />
      </SettingsGroup>

      <SettingsGroup title="Chat input">
        <SwitchRow
          icon={SendHorizontal}
          title="Show send message button"
          description="A send button beside the message box, also on computers"
          checked={prefs.showSendButton}
          onChange={(v) => setPref('showSendButton', v)}
        />
      </SettingsGroup>

      <SettingsGroup title="Message spacing" footer="The space above each new sender's messages.">
        <SpacingPreview />
        <ChoiceRow icon={Rows3} title="Space between message groups">
          <Segmented
            aria-label="Space between message groups"
            value={String(prefs.messageGroupSpacing)}
            onChange={(v) => setPref('messageGroupSpacing', Number(v) as MessageGroupSpacing)}
            options={MESSAGE_GROUP_SPACINGS.map((px) => ({ value: String(px), label: `${px}px` }))}
          />
        </ChoiceRow>
      </SettingsGroup>

      <SettingsGroup title="Text">
        <SettingsRow
          icon={CaseSensitive}
          title="Chat text size and text-to-speech"
          description={`In Chats: ${FONT_SIZES[prefs.fontSize]?.label ?? 'Medium'} text, /tts messages ${prefs.ttsPlayback ? 'on' : 'off'}`}
          to="/settings/chats"
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
