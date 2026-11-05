/**
 * The wiring that opens the right conversation.
 *
 * The rule this file pins: `/conversation/[id]` is keyed by the **server's
 * conversation id** and nothing else. Messages ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ All navigates with
 * `conversation.id` from `GET /conversations`; the start-conversation flow
 * navigates with the id the server answered `POST /conversations` with; and no
 * failure path navigates at all. Passing a user id where a conversation id
 * belongs opens a 404 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the exact bug this wiring exists to prevent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// `messagingQueryKeys` lives in the realtime bridge, whose module graph loads
// react-native's AppState, expo-secure-store and expo-device ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â none of which
// can load in Node. The keys themselves are pure; the same substitution
// `realtime/client.test.ts` makes is used here.
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

vi.mock('@/auth/tokenStorage', () => ({
  tokenStorage: {
    get: async () => null,
    set: async () => undefined,
    clear: async () => undefined,
  },
}));

vi.mock('@/lib/env', () => ({
  env: { apiBaseUrl: 'http://api.test/api/v1' },
}));

/* eslint-disable import/first -- vi.mock must precede the imports it replaces. */
import { messagingQueryKeys } from '@/realtime/queryBridge';
/* eslint-enable import/first */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Messages ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ All navigates by the serverÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s conversation id', () => {
  const screen = read('../../app/(candidate)/messages.tsx');

  it('the row is pressable and opens `/conversation/{conversation.id}`', () => {
    expect(screen).toContain('const open = () => router.push(`/conversation/${conversation.id}` as never);');
    expect(screen).toContain('<Pressable');
    expect(screen).toContain('onPress={open}');
  });

  it('the row shows the other participant Ã¢â‚¬â€ never the caller', () => {
    // members includes the caller, so the avatar/name must exclude them by
    // internal user id rather than always taking the first member.
    expect(screen).toContain('const { principal } = useAuth();');
    expect(screen).toContain('const selfUserId = principal?.id ?? null;');
    expect(screen).toContain('const primary = otherParticipant(conversation.members, selfUserId);');
    expect(screen).not.toContain('const primary = conversation.members[0];');
  });
});
describe('the start-conversation flow navigates only with the serverÃ¢â‚¬â„¢s answer', () => {
  const connections = read('../../app/(candidate)/connections.tsx');

  it('navigation happens in onSuccess, with the returned conversation id', () => {
    expect(connections).toContain('mutationFn: () => openConversation(connection.user.user_id),');
    expect(connections).toContain('router.push(`/conversation/${conversation.id}` as never);');
  });

  it('a failure surfaces inline and never navigates', () => {
    expect(connections).toContain('onError: (err: unknown) => {');
    expect(connections).toContain('disabled={open.isPending}');
    // The error is rendered beside the button, not swallowed.
    expect(connections).toContain('accessibilityLiveRegion="polite"');
  });
});

describe('the public profile reuses the same start-conversation flow', () => {
  const profile = read('../../app/(candidate)/user/[id].tsx');

  it('opens by internal user id and navigates only with the serverÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s conversation id', () => {
    expect(profile).toContain('mutationFn: () => openConversation(profileUserId),');
    expect(profile).toContain('router.push(`/conversation/${conversation.id}` as never);');
  });

  it('shows connect-first guidance instead of a button that could only 403', () => {
    expect(profile).toContain('Connect with {profileName} to start messaging.');
  });

  it('never offers messaging on your own profile', () => {
    expect(profile).toContain('{profile.data && !profile.data.is_owner ? (');
  });
});

describe('the conversation screen loads and retries against the real routes', () => {
  const screen = read('../../app/(candidate)/conversation/[id].tsx');

  it('the route param drives both reads, disabled while the id is missing', () => {
    expect(screen).toContain('const { id } = useLocalSearchParams<{ id: string }>();');
    expect(screen).toContain('queryKey: messagingQueryKeys.conversation(conversationId ?? \'\')');
    expect(screen).toContain('queryFn: () => fetchConversation(conversationId as string),');
    expect(screen).toContain('queryFn: () => listMessages(conversationId as string, { limit: MESSAGE_PAGE_LIMIT }),');
    expect(screen).toContain('enabled: conversationId !== null');
  });

  it('a missing id is an honest notice, and a refused read offers a retry', () => {
    expect(screen).toContain('title="Conversation not found"');
    // Both reads name their own failure ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the conversation detail and the
    // message history are separate requests, and the reader must be able to
    // tell which one the server refused.
    expect(screen).toContain("\"Couldn't load this conversation\"");
    expect(screen).toContain("\"Couldn't load these messages\"");
    expect(screen).toContain('onRetry={refreshThread}');
    // The banner carries the server's own message instead of a hard-coded
    // guess: 401/403/404/429/5xx and a network failure each read differently.
    expect(screen).toContain('loadFailure instanceof ApiError');
  });

  it('refreshing invalidates the thread, the conversation detail, and the inbox list', () => {
    expect(screen).toMatch(
      /invalidateQueries\(\{\s*queryKey: messagingQueryKeys\.messages\(conversationId \?\? ''\),\s*\}\)/,
    );
    expect(screen).toMatch(/invalidateQueries\(\{ queryKey: messagingQueryKeys\.conversations \}\)/);
    expect(screen).toMatch(
      /invalidateQueries\(\{\s*queryKey: messagingQueryKeys\.conversation\(conversationId \?\? ''\),\s*\}\)/,
    );
  });

  it('the conversation query keys are the shared ones the inbox and bridge use', () => {
    // One spelling of the key everywhere, or an invalidation lands in a cache
    // nothing reads.
    expect(messagingQueryKeys.conversations).toEqual(['conversations']);
    expect(messagingQueryKeys.messages('c1')).toEqual(['conversations', 'c1', 'messages']);
  });

  it('the route is declared for candidates and registered as a detail screen', () => {
    const nav = read('../../config/navConfig.ts');
    expect(nav).toContain("path: '/conversation/[id]'");
  });
});