/** Demo playlist — clearly labeled sample content for development/demonstration. *
 *
 * This playlist is NOT production catalogue content. Its lesson titles are
 * sample lesson titles, not claims that corresponding public videos already
 * exist. Each lesson references a real server lecture only when one is
 * available; otherwise it renders an honest unavailable-source state.
 *
 * Do not merge this into the production catalogue or present it as a real
 * course. Source URLs and attribution are documented in the feature report.
 */

import type { CourseLecture } from '@/types/course';

export const DEMO_PLAYLIST_ID = 'demo-web-dev-foundations';

export interface DemoPlaylistLecture {
  /** Stable demo id. */
  readonly id: string;
  /** Sample lesson title. */
  readonly title: string;
  /** Short description of what the lesson covers. */
  readonly description: string | null;
  /** Optional real server lecture id when a matching lecture exists. */
  readonly serverLectureId: string | null;
  /** Optional real server course id the lecture belongs to. */
  readonly serverCourseId: string | null;
}

export interface DemoPlaylist {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Honestly labeled as demo content. */
  readonly demo: boolean;
  readonly lectures: readonly DemoPlaylistLecture[];
}

/** Web Development Foundations — a guided introduction to how websites work. */
export const DEMO_PLAYLIST: DemoPlaylist = {
  id: DEMO_PLAYLIST_ID,
  title: 'Web Development Foundations',
  description:
    'A guided introduction to how websites work, HTML, CSS and JavaScript.',
  demo: true,
  lectures: [
    {
      id: 'demo-web-1',
      title: 'How the Web Works',
      description: 'Browsers, servers, HTTP and how a page reaches your screen.',
      serverLectureId: null,
      serverCourseId: null,
    },
    {
      id: 'demo-web-2',
      title: 'HTML Page Structure',
      description: 'Elements, tags and the document skeleton.',
      serverLectureId: null,
      serverCourseId: null,
    },
    {
      id: 'demo-web-3',
      title: 'CSS Styling Fundamentals',
      description: 'Selectors, the box model and layout.',
      serverLectureId: null,
      serverCourseId: null,
    },
    {
      id: 'demo-web-4',
      title: 'JavaScript Basics',
      description: 'Variables, functions and interactivity.',
      serverLectureId: null,
      serverCourseId: null,
    },
  ],
};

/** Total lecture count derived from the actual demo sequence. */
export function demoPlaylistLectureCount(playlist: DemoPlaylist): number {
  return playlist.lectures.length;
}
