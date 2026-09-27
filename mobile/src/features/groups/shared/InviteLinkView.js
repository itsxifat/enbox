/**
 * Invite link page (groups, channels, communities — web shared/InviteLinkView.tsx): the
 * `/join/:code` link with copy, share and (admins) reset.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Copy, Link2, RotateCcw, Share2 } from 'lucide-react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Skeleton, T, confirm, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/theme';
import { InfoPage, InfoRow, InfoSection } from './InfoLayout';
import { copyLink, inviteUrl, shareLink } from './share';

export function InviteLinkView({
  title = 'Invite link',
  name,
  avatar,
  kind,
  code: initial,
  load,
  reset,
  onBack,
  backIcon = 'arrow',
}) {
  const { tw } = useTheme();
  const [code, setCode] = useState(initial);
  const [error, setError] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (initial) {
      setCode(initial);
      return;
    }
    let alive = true;
    load()
      .then((r) => alive && setCode(r.code))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const url = code ? inviteUrl(code) : '';
  const noun = kind === 'channel' ? 'channel' : kind === 'community' ? 'community' : 'group';
  const verb = kind === 'channel' ? 'follow' : 'join';

  const doReset = async () => {
    if (!reset) return;
    const ok = await confirm({
      title: 'Reset link?',
      message: `The current link will stop working. Anyone who tries to use it won't be able to ${verb} this ${noun}.`,
      confirmLabel: 'Reset link',
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const r = await reset();
      setCode(r.code);
      toast.success('Invite link reset');
    } catch (e) {
      toast.error(e);
    } finally {
      setResetting(false);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title={title} back={onBack} backIcon={backIcon} />
      <ScrollView contentContainerStyle={tw`pt-1`}>
        <InfoPage>
          <InfoSection style={tw`px-5 py-5`}>
            <View style={tw`flex-row items-center gap-4`}>
              {avatar}
              <View style={tw`min-w-0 flex-1`}>
                <T numberOfLines={1} style={tw`text-[16px] font-semibold`}>
                  {name}
                </T>
                {code ? (
                  <T selectable style={tw`mt-0.5 text-[14px] text-brand-ink`}>
                    {url}
                  </T>
                ) : error ? (
                  <T style={tw`mt-0.5 text-[14px] text-danger`}>{error}</T>
                ) : (
                  <Skeleton style={tw`mt-1.5 h-4 w-4/5`} />
                )}
              </View>
            </View>
            <T style={[tw`mt-4 text-[13px] text-muted`, { lineHeight: 21 }]}>
              Anyone with Enbox can use this link to {verb} this {noun}. Only share it with people
              you trust.
            </T>
          </InfoSection>
          <InfoSection>
            <InfoRow
              icon={Copy}
              label="Copy link"
              disabled={!code}
              onPress={() => void copyLink(url)}
              chevron={false}
            />
            <InfoRow
              icon={Share2}
              label="Share link"
              disabled={!code}
              onPress={() =>
                void shareLink({
                  title: name,
                  text: `Follow this link to ${verb} my Enbox ${noun} “${name}”`,
                  url,
                })
              }
              chevron={false}
            />
            {reset ? (
              <InfoRow
                icon={resetting ? Link2 : RotateCcw}
                label={resetting ? 'Resetting…' : 'Reset link'}
                danger
                disabled={!code || resetting}
                onPress={() => void doReset()}
              />
            ) : null}
          </InfoSection>
        </InfoPage>
      </ScrollView>
    </View>
  );
}
