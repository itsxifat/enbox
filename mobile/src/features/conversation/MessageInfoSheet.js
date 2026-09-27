/** Message info (sender only, not channels): read by / delivered to / pending (web MessageInfoSheet.tsx). */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Clock3 } from 'lucide-react-native';
import { renderMentions, userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { DoubleTickIcon, Icon } from '@/components/icons';
import { ListSection, PageSpinner, Sheet, T } from '@/components/ui';
import { ChatBackground, useChatAppearance } from '@/features/appearance/ChatBackground';
import { PreviewLine, mentionName, previewParts } from '@/features/chats/preview';
import { api, errorMessage } from '@/lib/api';
import { formatChatListTime, formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chats';
import { ColorScope, useTheme } from '@/theme';
import { useConversationUi } from './state';

function Person({ user, at }) {
  const { tw } = useTheme();
  return (
    <View style={tw`flex-row items-center gap-3 px-4 py-2.5`}>
      <UserAvatar user={user} size="md" />
      <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[15px]`}>
        {userDisplayName(user)}
      </T>
      {at ? (
        <T style={tw`text-[13px] text-muted`}>
          {formatChatListTime(at)}
          {formatChatListTime(at) !== formatTime(at) ? `, ${formatTime(at)}` : ''}
        </T>
      ) : null}
    </View>
  );
}

function SectionTitle({ icon, color, children }) {
  const { tw, c } = useTheme();
  return (
    <View style={tw`flex-row items-center gap-1.5`}>
      <Icon icon={icon} size={16} color={color ?? c.muted} />
      <T style={[tw`text-[11px] font-semibold uppercase text-muted`, { letterSpacing: 0.44 }]}>
        {children}
      </T>
    </View>
  );
}

export function MessageInfoSheet() {
  const { tw, c, shadow } = useTheme();
  const m = useConversationUi((s) => s.info);
  const chat = useChat(m?.chatId);
  const me = useAuth((s) => s.user?.id);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const read = chat?.readWatermark;
  const delivered = chat?.deliveredWatermark;
  const appearance = useChatAppearance(chat);

  useEffect(() => {
    if (!m) {
      setInfo(null);
      setError(null);
      return;
    }
    let cancelled = false;
    api
      .get(`/api/messages/${m.id}/info`)
      .then((i) => !cancelled && setInfo(i))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [m, read, delivered]);

  const close = () => useConversationUi.getState().openInfo(null);
  return (
    <Sheet open={!!m} onClose={close} title="Message info">
      {m ? (
        <View>
          <ColorScope overrides={appearance.colors}>
            <View style={tw`relative px-4 py-6`}>
              <ChatBackground appearance={appearance} />
              <View
                style={[
                  tw`ml-auto rounded-lg bg-bubble-out px-3 py-2`,
                  { maxWidth: '85%' },
                  shadow.bubble,
                ]}
              >
                {m.text ? (
                  <T numberOfLines={6} style={tw`text-[15px]`}>
                    {renderMentions(m.text, mentionName)}
                  </T>
                ) : (
                  <PreviewLine parts={previewParts(m, { meId: me, chat })} color={c.fg} />
                )}
                <T style={tw`mt-1 text-right text-[11px] text-bubble-out-meta`}>
                  {formatTime(m.createdAt)}
                </T>
              </View>
            </View>
          </ColorScope>
          {error ? (
            <T style={tw`px-4 py-6 text-center text-sm text-danger`}>{error}</T>
          ) : !info ? (
            <PageSpinner />
          ) : (
            <>
              <ListSection
                title={
                  <SectionTitle icon={DoubleTickIcon} color={c['tick-read']}>
                    Read by
                  </SectionTitle>
                }
              >
                {info.readBy.length ? (
                  info.readBy.map((r) => <Person key={r.user.id} user={r.user} at={r.at} />)
                ) : (
                  <T style={tw`px-4 pb-2 text-[13px] text-subtle`}>Nobody yet</T>
                )}
              </ListSection>
              <ListSection title={<SectionTitle icon={DoubleTickIcon}>Delivered to</SectionTitle>}>
                {info.deliveredTo.length ? (
                  info.deliveredTo.map((r) => <Person key={r.user.id} user={r.user} at={r.at} />)
                ) : (
                  <T style={tw`px-4 pb-2 text-[13px] text-subtle`}>Nobody else</T>
                )}
              </ListSection>
              {info.pending.length ? (
                <ListSection title={<SectionTitle icon={Clock3}>Not delivered yet</SectionTitle>}>
                  {info.pending.map((u) => (
                    <Person key={u.id} user={u} />
                  ))}
                </ListSection>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}
