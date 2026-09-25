/**
 * SEC-4: responses still in flight at logout never reach the (reset) stores, so the next
 * account on this tab can't see the previous account's viewer-specific data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeUser } from '@/test/factories';
import { useChats } from '@/stores/chats';
import { useUsers } from '@/stores/users';
import { toast, useUi } from '@/stores/ui';
import { ApiError, api, isSessionChangedError, setApiToken } from './api';
import { resetSessionState } from './session';

function deferredFetch() {
  let respond!: (body: unknown) => void;
  const fn = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        respond = (body) =>
          resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
      }),
  );
  vi.stubGlobal('fetch', fn);
  return { fn, respond: (body: unknown) => respond(body) };
}

/** Logout (clearSession) then another account logs in on the same tab. */
function switchAccount() {
  setApiToken(null);
  resetSessionState();
  setApiToken('token-B');
}

afterEach(() => {
  setApiToken(null);
  resetSessionState();
  vi.unstubAllGlobals();
});

describe('session guard', () => {
  it('a response sent with the previous token is rejected as session-changed', async () => {
    setApiToken('token-A');
    const f = deferredFetch();
    const p = api.get('/api/me');
    switchAccount();
    f.respond({ id: 'a' });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isSessionChangedError(err)).toBe(true);
  });

  it("the previous account's users batch never lands in the users store", async () => {
    setApiToken('token-A');
    const f = deferredFetch();
    const p = useUsers.getState().fetchUsers(['u1']);
    await new Promise((r) => setTimeout(r, 0)); // the batch is sent on the next tick
    switchAccount();
    f.respond([makeUser({ id: 'u1', phone: '+15550100', contactName: 'Saved by A' })]);
    await p.catch(() => undefined);
    expect(useUsers.getState().byId.u1).toBeUndefined();
  });

  it("the previous account's chat list never lands in the chats store", async () => {
    setApiToken('token-A');
    const f = deferredFetch();
    const p = useChats.getState().loadChats();
    switchAccount();
    f.respond([makeChat({ id: 'chat-of-A' })]);
    await p.catch(() => undefined);
    const s = useChats.getState();
    expect(s.byId).toEqual({});
    expect(s.loaded).toBe(false);
    expect(s.error).toBeNull();
  });

  it('does not toast session-changed failures', () => {
    const before = useUi.getState().toasts.length;
    toast.error(new ApiError('aborted', 'Session changed', 0, { sessionChanged: true }));
    expect(useUi.getState().toasts.length).toBe(before);
    toast.error(new ApiError('aborted', 'Upload cancelled'));
    expect(useUi.getState().toasts.length).toBe(before + 1);
  });

  it('requests of the current session are unaffected', async () => {
    setApiToken('token-B');
    const f = deferredFetch();
    const p = api.get('/api/me');
    f.respond({ id: 'b' });
    await expect(p).resolves.toEqual({ id: 'b' });
  });
});
