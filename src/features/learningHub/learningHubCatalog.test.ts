import { describe, expect, it } from 'vitest';

import {
  buildCatalog,
  filterCatalogItems,
  lectureToCatalogItem,
  demoLectureToCatalogItem,
  type CatalogItem,
  type LectureFeedItem,
} from '@/features/learningHub/learningHubModel';
import type { DemoPlaylistLecture } from '@/features/learningHub/demoPlaylist';

function serverItem(overrides: Partial<LectureFeedItem> = {}): LectureFeedItem {
  return {
    lectureId: 'lec-1',
    title: 'HTML Basics',
    kind: 'hosted_video',
    durationSeconds: 120,
    isPreview: false,
    courseId: 'course-1',
    courseTitle: 'Web Fundamentals',
    category: 'Web Development',
    instructorName: 'Alice',
    ...overrides,
  };
}

function demoLecture(overrides: Partial<DemoPlaylistLecture> = {}): DemoPlaylistLecture {
  return {
    id: 'demo-web-1',
    title: 'How the Web Works',
    description: 'Browsers, servers, HTTP and how a page reaches your screen.',
    serverLectureId: null,
    serverCourseId: null,
    ...overrides,
  };
}

describe('lectureToCatalogItem', () => {
  it('converts a server lecture to a catalog item with source server', () => {
    const item = lectureToCatalogItem(serverItem());
    expect(item.source).toBe('server');
    expect(item.isDemo).toBe(false);
    expect(item.title).toBe('HTML Basics');
    expect(item.lectureId).toBe('lec-1');
    expect(item.courseId).toBe('course-1');
    expect(item.category).toBe('Web Development');
  });
});

describe('demoLectureToCatalogItem', () => {
  it('converts a demo lecture to a catalog item with source demo', () => {
    const item = demoLectureToCatalogItem(demoLecture(), 'Web Development Foundations');
    expect(item.source).toBe('demo');
    expect(item.isDemo).toBe(true);
    expect(item.title).toBe('How the Web Works');
    expect(item.lectureId).toBeNull();
    expect(item.courseId).toBeNull();
    expect(item.category).toBeNull();
    expect(item.courseTitle).toBe('Web Development Foundations');
  });
});

describe('buildCatalog', () => {
  it('combines server items and demo lessons without duplicates', () => {
    const server = [serverItem({ lectureId: 'lec-1', title: 'HTML Basics' })];
    const demo = [demoLecture({ id: 'demo-web-1', title: 'How the Web Works' })];
    const catalog = buildCatalog(server, demo, 'Web Development Foundations');
    expect(catalog).toHaveLength(2);
    expect(catalog[0].source).toBe('server');
    expect(catalog[1].source).toBe('demo');
  });

  it('deduplicates by id when server and demo share an id', () => {
    const server = [serverItem({ lectureId: 'shared-id', title: 'Shared' })];
    const demo = [demoLecture({ id: 'shared-id', title: 'Demo Shared' })];
    const catalog = buildCatalog(server, demo, 'Playlist');
    expect(catalog).toHaveLength(1);
    expect(catalog[0].source).toBe('server');
  });

  it('includes all four demo lessons', () => {
    const demoLessons = [
      demoLecture({ id: 'demo-web-1', title: 'How the Web Works' }),
      demoLecture({ id: 'demo-web-2', title: 'HTML Page Structure' }),
      demoLecture({ id: 'demo-web-3', title: 'CSS Styling Fundamentals' }),
      demoLecture({ id: 'demo-web-4', title: 'JavaScript Basics' }),
    ];
    const catalog = buildCatalog([], demoLessons, 'Web Development Foundations');
    expect(catalog).toHaveLength(4);
    expect(catalog.map((c) => c.title)).toEqual([
      'How the Web Works',
      'HTML Page Structure',
      'CSS Styling Fundamentals',
      'JavaScript Basics',
    ]);
  });
});

describe('demo lessons discoverable', () => {
  it('all four demo lessons can be found by title', () => {
    const demoLessons = [
      demoLecture({ id: 'demo-web-1', title: 'How the Web Works', description: 'Browsers, servers, HTTP' }),
      demoLecture({ id: 'demo-web-2', title: 'HTML Page Structure', description: 'Elements, tags' }),
      demoLecture({ id: 'demo-web-3', title: 'CSS Styling Fundamentals', description: 'Selectors, box model' }),
      demoLecture({ id: 'demo-web-4', title: 'JavaScript Basics', description: 'Variables, functions' }),
    ];
    const catalog = buildCatalog([], demoLessons, 'Web Development Foundations');
    const titles = ['How the Web Works', 'HTML Page Structure', 'CSS Styling Fundamentals', 'JavaScript Basics'];
    for (const title of titles) {
      const result = filterCatalogItems(catalog, { search: title, topic: null, sort: 'recent' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe(title);
      expect(result[0].isDemo).toBe(true);
    }
  });

  it('demo lessons can be found by description terms', () => {
    const demoLessons = [
      demoLecture({ id: 'demo-web-1', title: 'How the Web Works', description: 'Browsers, servers, HTTP' }),
    ];
    const catalog = buildCatalog([], demoLessons, 'Web Development Foundations');
    const result = filterCatalogItems(catalog, { search: 'browsers', topic: null, sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('How the Web Works');
  });

  it('demo items are labeled correctly', () => {
    const demoLessons = [demoLecture({ id: 'demo-web-1', title: 'How the Web Works' })];
    const catalog = buildCatalog([], demoLessons, 'Web Development Foundations');
    expect(catalog[0].isDemo).toBe(true);
    expect(catalog[0].source).toBe('demo');
  });

  it('demo items do not duplicate server-backed results', () => {
    const server = [serverItem({ lectureId: 'lec-1', title: 'HTML Basics' })];
    const demo = [demoLecture({ id: 'demo-web-1', title: 'How the Web Works' })];
    const catalog = buildCatalog(server, demo, 'Web Development Foundations');
    expect(catalog).toHaveLength(2);
  });

  it('null server IDs are never treated as valid server resource IDs', () => {
    const item = demoLectureToCatalogItem(
      demoLecture({ serverLectureId: null, serverCourseId: null }),
      'Web Development Foundations'
    );
    expect(item.lectureId).toBeNull();
    expect(item.courseId).toBeNull();
    expect(item.isDemo).toBe(true);
  });
});

describe('filterCatalogItems', () => {
  const items: readonly CatalogItem[] = [
    lectureToCatalogItem(serverItem({ lectureId: 'lec-1', title: 'HTML Basics', category: 'Web Development' })),
    lectureToCatalogItem(serverItem({ lectureId: 'lec-2', title: 'CSS Layouts', category: 'Design' })),
    demoLectureToCatalogItem(demoLecture({ id: 'demo-web-1', title: 'How the Web Works', description: 'Browsers, servers, HTTP' }), 'Web Development Foundations'),
    demoLectureToCatalogItem(demoLecture({ id: 'demo-web-3', title: 'CSS Styling Fundamentals', description: 'Selectors, the box model' }), 'Web Development Foundations'),
  ];

  it('returns all items for empty search', () => {
    const result = filterCatalogItems(items, { search: '', topic: null, sort: 'recent' });
    expect(result).toHaveLength(4);
  });

  it('matches exact title', () => {
    const result = filterCatalogItems(items, { search: 'HTML Basics', topic: null, sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('HTML Basics');
  });

  it('matches partial title', () => {
    const result = filterCatalogItems(items, { search: 'CSS', topic: null, sort: 'recent' });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toContain('CSS Layouts');
    expect(result.map((r) => r.title)).toContain('CSS Styling Fundamentals');
  });

  it('is case-insensitive', () => {
    const result = filterCatalogItems(items, { search: 'html basics', topic: null, sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('HTML Basics');
  });

  it('handles leading/trailing whitespace', () => {
    const result = filterCatalogItems(items, { search: '  HTML Basics  ', topic: null, sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('HTML Basics');
  });

  it('matches description terms', () => {
    const result = filterCatalogItems(items, { search: 'box model', topic: null, sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('CSS Styling Fundamentals');
  });

  it('matches demo lesson titles', () => {
    const result = filterCatalogItems(items, { search: 'How the Web Works', topic: null, sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].isDemo).toBe(true);
  });

  it('returns no results for unmatched term', () => {
    const result = filterCatalogItems(items, { search: 'quantum physics', topic: null, sort: 'recent' });
    expect(result).toHaveLength(0);
  });

  it('combines search with topic filter', () => {
    const result = filterCatalogItems(items, { search: 'CSS', topic: 'Design', sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('CSS Layouts');
  });

  it('combines search with sort order', () => {
    const result = filterCatalogItems(items, { search: 'CSS', topic: null, sort: 'title' });
    expect(result).toHaveLength(2);
    expect(result[0].title.localeCompare(result[1].title)).toBeLessThanOrEqual(0);
  });

  it('clears search while preserving topic filter', () => {
    const result = filterCatalogItems(items, { search: '', topic: 'Design', sort: 'recent' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('CSS Layouts');
  });

  it('Reset All clears every filter', () => {
    const result = filterCatalogItems(items, { search: '', topic: null, sort: 'recent' });
    expect(result).toHaveLength(4);
  });

  it('does not duplicate items', () => {
    const result = filterCatalogItems(items, { search: '', topic: null, sort: 'recent' });
    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses stable keys (id field)', () => {
    const result = filterCatalogItems(items, { search: '', topic: null, sort: 'recent' });
    for (const item of result) {
      expect(item.id).toBeTruthy();
      expect(typeof item.id).toBe('string');
    }
  });
});