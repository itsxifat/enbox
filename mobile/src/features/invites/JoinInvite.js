/**
 * Invite landing at /join/:code (web features/invites/JoinInvitePage.tsx): preview
 * (GET /api/invites/:code) with community context, then Join / Follow
 * (POST /api/invites/:code/join) and open the chat, channel or community.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Link2Off, Megaphone, RefreshCw, UsersRound } from 'lucide-react-native';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@enbox/shared';
import { Icon, LogoMark } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, EmptyState, Skeleton, T, toast } from '@/components/ui';
import { RichText } from '@/features/groups/shared/MediaGallery';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { useTheme } from '@/theme';

const CODE_RE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** Where to go for a joined/previewed invite target. */
export function invitePath(kind, id) {
  if (kind === 'channel') return `/updates/channels/${id}`;
  if (kind === 'community') return `/communities/${id}`;
  return `/chats/${id}`;
}

const NOUN = { group: 'Group', community: 'Community', channel: 'Channel' };

export function JoinInvite({ code = '' }) {
  const { tw } = useTheme();
  const router = useRouter();
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!CODE_RE.test(code)) {
      setState({ status: 'invalid' });
      return undefined;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    api
      .get(`/api/invites/${code}`, { signal: ctrl.signal })
      .then((preview) => setState({ status: 'ready', preview }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 400))
          setState({ status: 'invalid' });
        else setState({ status: 'error', message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [code, attempt]);

  const join = async (preview) => {
    setJoining(true);
    try {
      const r = await api.post(`/api/invites/${code}/join`);
      if (r.chat) useChats.getState().upsertChat(r.chat);
      if (r.community) useCommunities.getState().upsertCommunity(r.community);
      toast.success(
        preview.kind === 'channel'
          ? `You're following ${preview.name}`
          : `You joined “${preview.name}”`,
      );
      router.replace(invitePath(r.kind, r.id));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        // Already a member/follower (e.g. joined on another device): just open it.
        router.replace(invitePath(preview.kind, preview.id));
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setState({ status: 'invalid' });
        return;
      }
      toast.error(e);
      setAttempt((n) => n + 1);
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={tw`flex-1 bg-app`}>
      <PaneHeader title="Invite link" back="/chats" />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`px-4 py-8`}>
        {state.status === 'loading' ? (
          <Card>
            <View style={tw`items-center gap-3 py-2`} accessibilityLabel="Loading invite">
              <Skeleton circle style={tw`size-28`} />
              <Skeleton style={tw`mt-2 h-6 w-48`} />
              <Skeleton style={tw`h-4 w-32`} />
              <Skeleton style={tw`mt-4 h-11 w-full rounded-full`} />
            </View>
          </Card>
        ) : state.status === 'invalid' ? (
          <Card>
            <EmptyState
              icon={Link2Off}
              title="This invite link isn't valid"
              description="It may have been reset by an admin, or the group, channel or community no longer exists. Ask for a new link."
              action={
                <Button variant="soft" onPress={() => router.replace('/chats')}>
                  Go to chats
                </Button>
              }
            />
          </Card>
        ) : state.status === 'error' ? (
          <Card>
            <EmptyState
              icon={RefreshCw}
              title="Couldn't open the invite"
              description={state.message}
              action={<Button onPress={() => setAttempt((n) => n + 1)}>Try again</Button>}
            />
          </Card>
        ) : (
          <PreviewCard
            preview={state.preview}
            joining={joining}
            onJoin={() => void join(state.preview)}
            onOpen={() => router.replace(invitePath(state.preview.kind, state.preview.id))}
          />
        )}
        <View style={tw`mt-6 flex-row items-center justify-center gap-2`}>
          <LogoMark size={16} />
          <T style={tw`shrink text-[12.5px] text-subtle`}>
            Invites on Enbox are private links. Only join groups you trust.
          </T>
        </View>
      </ScrollView>
    </View>
  );
}

function Card({ children }) {
  const { tw, shadow } = useTheme();
  return <View style={[tw`rounded-3xl bg-surface p-6`, shadow.elevated]}>{children}</View>;
}

function PreviewCard({ preview: p, joining, onJoin, onOpen }) {
  const { tw, c } = useTheme();
  const noun = NOUN[p.kind];
  const count =
    p.kind === 'channel'
      ? `${formatCount(p.memberCount)} ${p.memberCount === 1 ? 'follower' : 'followers'}`
      : `${formatCount(p.memberCount)} ${p.memberCount === 1 ? 'member' : 'members'}`;
  const cta = p.kind === 'channel' ? 'Follow channel' : `Join ${noun.toLowerCase()}`;
  return (
    <Card>
      <View style={tw`items-center`}>
        <T
          style={[
            tw`text-center text-[13px] font-semibold uppercase text-brand-ink`,
            { letterSpacing: 0.33 },
          ]}
        >
          {p.isMember
            ? `${noun} invite`
            : p.kind === 'channel'
              ? "You're invited to follow"
              : "You're invited to join"}
        </T>
        <Avatar
          src={p.avatarUrl}
          name={p.name}
          colorSeed={p.id}
          kind={p.kind === 'community' ? 'community' : p.kind === 'channel' ? 'channel' : 'group'}
          size={112}
          style={tw`mt-5`}
        />
        <T style={tw`mt-4 text-center text-[24px] leading-tight font-semibold`}>{p.name}</T>
        <T style={tw`mt-1 text-[15px] text-muted`}>
          {noun} · {count}
        </T>
        {p.communityName ? (
          <View style={tw`mt-4 w-full flex-row items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3`}>
            <View style={tw`size-10 items-center justify-center rounded-[11px] bg-brand-soft`}>
              <Icon icon={UsersRound} size={20} color={c['brand-ink']} />
            </View>
            <View style={tw`min-w-0 flex-1`}>
              <T style={tw`text-[14px]`}>
                Part of <T style={tw`font-semibold`}>{p.communityName}</T>
              </T>
              <T style={tw`text-[12.5px] text-muted`}>
                Joining also makes you a member of this community.
              </T>
            </View>
          </View>
        ) : null}
        {p.description ? (
          <ScrollView style={tw`mt-4 max-h-40 w-full`} nestedScrollEnabled>
            <RichText
              text={p.description}
              style={[tw`text-center text-[14.5px] text-muted`, { lineHeight: 23.5 }]}
            />
          </ScrollView>
        ) : null}
        <View style={tw`mt-6 w-full`}>
          {p.isMember ? (
            <>
              <T style={tw`mb-3 text-center text-[14px] text-muted`}>
                {p.kind === 'channel'
                  ? "You're already following this channel."
                  : `You're already a member.`}
              </T>
              <Button fullWidth size="lg" onPress={onOpen}>
                {`Open ${noun.toLowerCase()}`}
              </Button>
            </>
          ) : p.canJoin ? (
            <Button
              fullWidth
              size="lg"
              loading={joining}
              onPress={onJoin}
              leftIcon={p.kind === 'channel' ? Megaphone : undefined}
            >
              {cta}
            </Button>
          ) : (
            <>
              <View accessibilityRole="alert" style={tw`mb-3 rounded-2xl bg-danger-soft px-4 py-3`}>
                <T style={tw`text-center text-[14px] text-danger`}>
                  {p.reason ?? `You can't join this ${noun.toLowerCase()}.`}
                </T>
              </View>
              <Button fullWidth size="lg" disabled>
                {cta}
              </Button>
            </>
          )}
        </View>
      </View>
    </Card>
  );
}
