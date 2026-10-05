/**
 * Share payload tests.
 *
 * The rule worth protecting is that the feed never shares a URL it invented.
 * There is no post-detail route in the app, so a constructed permalink would be
 * dead on arrival; these assertions pin that a share is text-only unless the
 * record itself carries a link.
 */

import { describe, expect, it } from 'vitest';

import {
  buildSharePayload,
  postLinkFor,
  SHARE_ATTRIBUTION,
  SHARE_BODY_LIMIT,
} from '@/features/feed/sharePayload';
import type { FeedPost } from '@/features/feed/feedModel';

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'post-1',
    kind: 'text',
    category: 'community',
    origin: 'profile',
    title: null,
    body: 'A short note about a project.',
    media: [],
    project: null,
    achievement: null,
    tags: [],
    createdAt: '2026-03-01T00:00:00Z',
    // The server is the only source of these; zero is the honest fixture default.
    engagement: { likeCount: 0, commentCount: 0, likedByMe: false },
    author: {
      name: 'Ada Lovelace',
      username: 'ada',
      publicId: 'pub_ada',
      headline: null,
      avatarUrl: null,
      profileHref: '/profile',
      verified: false,
    },
    ...overrides,
  };
}

describe('postLinkFor', () => {
  it('returns null for a post that carries no link at all', () => {
    expect(postLinkFor(makePost())).toBeNull();
  });

  it('prefers the project source URL, then the live demo', () => {
    const project = makePost({
      project: {
        title: 't',
        description: null,
        technologies: [],
        category: null,
        status: null,
        team: null,
        role: null,
        sourceUrl: 'https://github.com/example/repo',
        liveUrl: 'https://example.com',
      },
    });
    expect(postLinkFor(project)).toBe('https://github.com/example/repo');
    expect(postLinkFor(makePost({ project: { ...project.project!, sourceUrl: null } }))).toBe(
      'https://example.com',
    );
  });

  it('falls back to a certificate’s verification URL', () => {
    const certificate = makePost({
      achievement: {
        title: 't',
        issuer: 'Issuer',
        achievedOn: null,
        description: null,
        verificationUrl: 'https://example.com/verify/abc',
      },
    });
    expect(postLinkFor(certificate)).toBe('https://example.com/verify/abc');
  });
});

describe('buildSharePayload', () => {
  it('never attaches a URL the record does not carry', () => {
    const payload = buildSharePayload(makePost({ id: 'project-7' }));
    expect(payload.url).toBeUndefined();
    // Nothing that looks like a permalink may appear in the message either.
    expect(payload.message).not.toMatch(/https?:\/\/mahajob/);
    expect(payload.message).not.toMatch(/\/posts\//);
  });

  it('includes a real URL when the record carries one', () => {
    const payload = buildSharePayload(
      makePost({
        project: {
          title: 't',
          description: null,
          technologies: [],
          category: null,
          status: null,
          team: null,
          role: null,
          sourceUrl: 'https://github.com/example/repo',
          liveUrl: null,
        },
      }),
    );
    expect(payload.url).toBe('https://github.com/example/repo');
  });

  it('always attributes the share, so shared text is not mistaken for the reader’s own', () => {
    expect(buildSharePayload(makePost()).message).toContain(SHARE_ATTRIBUTION);
  });

  it('includes both the title and the body when both exist', () => {
    const payload = buildSharePayload(makePost({ title: 'Campus Event Platform' }));
    expect(payload.message).toContain('Campus Event Platform');
    expect(payload.message).toContain('A short note about a project.');
  });

  it('excerpts a long body rather than sharing a wall of text', () => {
    const long = 'x'.repeat(SHARE_BODY_LIMIT + 200);
    const payload = buildSharePayload(makePost({ body: long }));
    const bodyPart = payload.message.split('\n\n')[0] ?? '';
    expect(bodyPart.length).toBeLessThanOrEqual(SHARE_BODY_LIMIT + 1);
    expect(payload.message.endsWith('…')).toBe(false);
    expect(payload.message).toContain(SHARE_ATTRIBUTION);
  });

  it('truncates with a visible ellipsis rather than cutting mid-word silently', () => {
    const long = `${'word '.repeat(60)}end`;
    const payload = buildSharePayload(makePost({ body: long }));
    expect(payload.message.split('\n\n')[0]?.endsWith('…')).toBe(true);
  });

  it('still produces a shareable message for a post with no text at all', () => {
    const payload = buildSharePayload(makePost({ body: null, title: null }));
    expect(payload.message).toBe(SHARE_ATTRIBUTION);
  });
});
