/**
 * Story viewer — the full-screen immersive reader for one person's stories.
 *
 * **Groups in, one position around, one media layer out.** The screen hands
 * `StoryGroup[]` (grouped by author) and an initial position; the viewer never
 * fetches and never groups — it renders the current group's progress segments,
 * header, caption, and exactly one `StoryMediaLayer` (keyed by story id, so the
 * previous player is released before the next mounts). All navigation
 * collapses into ONE function, `goToNextStory`, guarded by `advancingRef`: a
 * duplicated `playToEnd` cannot skip a story, manual taps supersede any
 * pending advance, and going back never exits the viewer.
 *
 * **Why the record-view effect depends on a primitive (the original crash).**
 * The old effect depended on `[currentStory, onStoryViewed]`, but
 * `useStoryList` rebuilds every story object each render and react-query's
 * mutation wrapper is a fresh object each render — so every commit re-fired
 * `POST /stories/{id}/view`, whose `onSuccess` invalidated the stories query,
 * which refetched, re-rendered, and re-fired… until React threw "Maximum
 * update depth exceeded" on the native module thread and the Android process
 * died. That is the reported production bug: caption visible ~1s, then the app
 * closes. The fix is structural: the effect depends on `storyId` (a
 * primitive), the callback is read through a ref free to change identity, and
 * each story id records exactly once per session — no re-render can re-fire it.
 *
 * Playback: video advances on the player's own `playToEnd` (actual bytes,
 * actual duration — never a hard-coded 5s); image/text stories use the
 * fallback interval in `StoryMediaLayer`. Progress segments are per story —
 * never one bar for all. Backgrounding pauses (no advance); closing unmounts
 * everything, so no player, listener or timer outlives the viewer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthorConnection } from '@/features/connection/useAuthorConnection';
import { deleteStory } from '@/api/stories';
import { queryKeys } from '@/api/queryKeys';
import { colors, radius, spacing, typography } from '@/theme/tokens';
import type { FastApiPage, Story, StoryItem } from '@/types/story';
import { DEMO_STORY_BADGE, isDemoStory, isDemoStoryId } from './demoStories';
import { useQueryClient } from '@tanstack/react-query';
import { getStoryOrigin } from './storyOrigin';
import { StoryMediaLayer } from './StoryMediaLayer';
import { formatStoryRelativeTime, getStoryTypeBadgeLabel } from './storyModel';
import {
  isPremiumStoryGroup,
  nextStoryPosition,
  repositionAfterStoryRemoval,
  previousStoryPosition,
  shouldShowStoryDetails,
  storyAt,
  storyTypeOf,
  type StoryGroup,
  type StoryPosition,
} from './storyGroups';

export interface StoryViewerProps {
  /** All people's stories, grouped; the viewer walks group → group. */
  readonly groups: readonly StoryGroup[];
  /** Where to open: the tapped group, resolved by the screen. */
  readonly initialPosition: StoryPosition;
  readonly onClose: () => void;
  /** Records a view — fired exactly once per story id (see the docstring). */
  readonly onStoryViewed?: (story: StoryItem) => void;
  readonly onOpenOpportunity?: (opportunityId: string) => void;
}

export function StoryViewer({
  groups,
  initialPosition,
  onClose,
  onStoryViewed,
  onOpenOpportunity,
}: StoryViewerProps) {
  const insets = useSafeAreaInsets();

  const [position, setPosition] = useState<StoryPosition>(initialPosition);
  const [progress, setProgress] = useState(0);
  // Bumped to remount the media layer *in place* (restart) without changing
  // which story is current.
  const [generation, setGeneration] = useState(0);
  // Hold-to-pause on a tap zone, and app-level pause — combined, never mixed.
  const [held, setHeld] = useState(false);
  const [backgrounded, setBackgrounded] = useState(AppState.currentState !== 'active');
  // Closing (item 5) freezes playback BEFORE the exit animation runs.
  const [closing, setClosing] = useState(false);
  // The three-dot delete dialog (item 2).
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const closingRef = useRef(false);
  const startCloseRef = useRef<() => void>(() => undefined);
  const queryClient = useQueryClient();

  // One closing animation per open: the native-driven value interpolates
  // the whole viewer toward the originating bubble (see startClose).
  const [closeProgress] = useState(() => new Animated.Value(0));

  const paused = held || backgrounded || closing;

  const group = groups[position.groupIndex];
  const currentStory = storyAt(groups, position);
  const storyId: string | null = currentStory?.id ?? null;

  // Refs mirror state/callbacks after every commit. Event listeners (video
  // completion, fallback timers) read these instead of closing over a stale
  // render's values.
  const positionRef = useRef(position);
  const groupsRef = useRef(groups);
  const storyRef = useRef<StoryItem | null>(currentStory);
  const onCloseRef = useRef(onClose);
  const onStoryViewedRef = useRef(onStoryViewed);
  useEffect(() => {
    positionRef.current = position;
    groupsRef.current = groups;
    storyRef.current = currentStory;
    onCloseRef.current = onClose;
    onStoryViewedRef.current = onStoryViewed;
  });

  // The double-advance guard: set the moment an advance begins, cleared only
  // after the new position has committed. A completion event that fires twice
  // (or fires mid-transition) sees `true` and is ignored — one completion
  // advances exactly one story, never two.
  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [position, generation]);

  /**
   * THE single advancement source of truth: next story in this group → first
   * story of the next group → close. Nothing else moves `position` forward —
   * not timers, not players, not tap zones.
   */
  const goToNextStory = useCallback(() => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    const next = nextStoryPosition(groupsRef.current, positionRef.current);
    if (!next) {
      // Last story of the last person: the same animated close.
      startCloseRef.current();
      return;
    }
    setProgress(0);
    setPosition(next);
  }, []);

  /** Manual next: supersede any in-flight advance, then use the one rule. */
  const handleTapNext = useCallback(() => {
    advancingRef.current = false;
    goToNextStory();
  }, [goToNextStory]);

  const goToPreviousStory = useCallback(() => {
    advancingRef.current = false;
    setProgress(0);
    const previous = previousStoryPosition(groupsRef.current, positionRef.current);
    if (previous) {
      setPosition(previous);
    } else {
      // At the very beginning: restart the first story rather than exiting —
      // going back must never close the viewer.
      setGeneration((current) => current + 1);
    }
  }, []);

  /**
   * Left zone: once the current story has visibly started the tap means
   * "restart this one"; before that it means "previous" (§30).
   */
  const handleTapPrevious = useCallback(() => {
    if (progress > 0.05) {
      advancingRef.current = false;
      setProgress(0);
      setGeneration((current) => current + 1);
      return;
    }
    goToPreviousStory();
  }, [progress, goToPreviousStory]);

  // Record a view exactly once per story id. The primitive dependency plus the
  // id set is what makes a re-render (or a refetch, or a mutation state change)
  // unable to re-fire the POST — the crash loop, closed for good.
// The one repositioning rule after a story vanishes from the group data
  // (its own deletion, or an expiry sweep racing behind the viewer). The ref
  // carries the deleted id only for the integer instant the cache update has
  // landed but the removal has not been folded into `position` yet — it is
  // cleared the moment the viewer moves, so a later refetch can never be
  // misread as a deletion.
  const expectedStoryIdRef = useRef<string | null>(null);
  const recordedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!storyId || recordedRef.current.has(storyId)) return;
    recordedRef.current.add(storyId);
    const story = storyRef.current;
    if (story) onStoryViewedRef.current?.(story);
  }, [storyId]);

  // A refetch while the viewer is open rebuilds `groups` — a newly published
  // story can shift every group index. Re-anchor on the *current story id* so
  // the reader never jumps to another person mid-play.
  useEffect(() => {
    const current = storyRef.current;
    if (!current) return;
    for (let g = 0; g < groups.length; g += 1) {
      const index = groups[g].stories.findIndex((story) => story.id === current.id);
      if (index === -1) continue;
      const now = positionRef.current;
      if (now.groupIndex !== g || now.storyIndex !== index) {
        setPosition({ groupIndex: g, storyIndex: index });
      }
      if (expectedStoryIdRef.current === current.id) {
        expectedStoryIdRef.current = null;
      }
      return;
    }
    // The story the viewer was showing is gone from the new groups — a
    // deletion (or an expiry sweep). Fold the removal into `position` with
    // the one rule in storyGroups: next remaining story, next person, else
    // close. This is the same single `setPosition` the refetch path above
    // uses — no parallel repositioning source. `closeRef` is late-bound
    // below, so the effect reads the starter through the indirection.
    const removedId = expectedStoryIdRef.current ?? storyRef.current?.id ?? '';
    expectedStoryIdRef.current = null;
    const next = repositionAfterStoryRemoval(groups, positionRef.current, removedId);
    if (!next) {
      startCloseRef.current();
      return;
    }
    setProgress(0);
    setPosition(next);
  }, [groups]);

  // Pause on background, resume on foreground. Nothing advances while
  // backgrounded: completion cannot fire while the player or timer is paused.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setBackgrounded(state !== 'active');
    });
    return () => subscription.remove();
  }, []);

  // The details notice belongs to one story: a fresh value per story id, so
  // moving between stories never carries a notice (or a cascade) across.
  const [detailsStoryId, setDetailsStoryId] = useState<string | null>(null);
  const detailsNotice =
    detailsStoryId !== null && storyId !== null && detailsStoryId === storyId;

  /**
   * The ONE closing path: pause first, animate toward the originating bubble,
   * then unmount.
   *
   * 1. `closing` flips `paused` true, so the video player and the static-layer
   *    timer stop BEFORE the animation's first frame — no audio continues in
   *    the background, and no completion event re-advances mid-teardown.
   * 2. The native-driven animation scales/translates/fades the whole viewer
   *    toward the bubble that opened it (a calm shrink-and-fade for deep
   *    links with no recorded origin). The Home screen underneath never moves.
   * 3. Only the animation's completion calls `onClose`: the route unmount then
   *    releases the player, removes its listeners, and clears the active story.
   *
   * The X button, the delete-flow close, the Android hardware back button, and
   * the final advance all come through here. Listener contexts use
   * `startCloseRef` so they never capture a stale closure.
   */
  const startClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    advancingRef.current = true;
    setClosing(true);
    setMenuOpen(false);
    setConfirmingDelete(false);
    closeProgress.setValue(0);
    Animated.timing(closeProgress, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onCloseRef.current();
    });
  }, [closeProgress]);
  useEffect(() => {
    startCloseRef.current = startClose;
  });
  /**
   * Delete the current story, then fold the removal into the viewer. The
   * cache update drops the Home bubble instantly; the [groups] effect above
   * performs the actual walk (next remaining story, next person, or close).
   */
  const handleDeleteStory = useCallback(async () => {
    const story = storyRef.current;
    if (!story || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStory(story.id);
      expectedStoryIdRef.current = story.id;
      queryClient.setQueryData<FastApiPage<Story>>(queryKeys.stories, (cached) => {
        if (!cached) return cached;
        const items = cached.items.filter((entry) => entry.id !== story.id);
        return { ...cached, items, total: Math.max(0, cached.total - 1) };
      });
      setMenuOpen(false);
      setConfirmingDelete(false);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.stories });
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'The story could not be deleted.',
      );
    } finally {
      setDeleting(false);
    }
  }, [deleting, queryClient]);
  // Android hardware Back takes the SAME animated path as the X button —
  // never a bare pop that would strand the old player underneath.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        setMenuOpen(false);
        setConfirmingDelete(false);
        return true;
      }
      startCloseRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [menuOpen]);
  const handleClose = useCallback(() => {
    startCloseRef.current();
  }, []);

  const isDemo = currentStory ? isDemoStory(currentStory) : false;
  const typeLabel = currentStory
    ? (currentStory.typeLabel ?? getStoryTypeBadgeLabel(currentStory.contentType))
    : '';
  const relTime = currentStory ? formatStoryRelativeTime(currentStory.createdAt) : '';
  const premium = group ? isPremiumStoryGroup(group) : false;
  const detailType = currentStory ? storyTypeOf(currentStory) : null;
  const showDetails = detailType !== null && shouldShowStoryDetails(detailType);
  const opportunity = currentStory?.opportunity ?? null;

  // Connect: real rows through the shared hook; hidden entirely on your own
  // stories and on local demo authors (nothing server-side to connect to).
  const canConnect = Boolean(group && !group.isSelf && !isDemoStoryId(group.authorPublicId));
  const connection = useAuthorConnection(canConnect && group ? group.authorPublicId : null);
  const connectLabel =
    connection.state === 'connected'
      ? 'Connected'
      : connection.state === 'pending'
        ? 'Pending'
        : 'Connect';

  const openOpportunity = useCallback(() => {
    if (opportunity && onOpenOpportunity) onOpenOpportunity(opportunity.id);
  }, [opportunity, onOpenOpportunity]);

  // Measured once per close: the bubble that opened the viewer (or the
  // centred fallback). Read here — not inside the animation — so Home can
  // scroll underneath without moving the target mid-flight. `closing` is the
  // trigger: the memo re-reads the latest recorded origin exactly when a new
  // close begins, and never while the animation is already running.
  const closeTarget = useMemo(() => {
    const screen = Dimensions.get('window');
    const origin = getStoryOrigin();
    return {
      dx: origin ? origin.x + origin.width / 2 - screen.width / 2 : 0,
      dy: origin ? origin.y + origin.height / 2 - screen.height / 2 : 0,
      scale: origin
        ? Math.max(0.12, Math.min(0.3, origin.width / screen.width))
        : 0.92,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  if (!group || !currentStory) return null;

  // The one closing choreography: whole-viewer shrink toward the recorded
  // bubble plus a fade. Native-driven, so Home keeps 60fps; the media layer
  // underneath is already paused via `closing`, so its last frame holds
  // without flashing while the viewer shrinks.
  const closeScale = closeProgress.interpolate({ inputRange: [0, 1], outputRange: [1, closeTarget.scale] });
  const closeTranslateX = closeProgress.interpolate({ inputRange: [0, 1], outputRange: [0, closeTarget.dx] });
  const closeTranslateY = closeProgress.interpolate({ inputRange: [0, 1], outputRange: [0, closeTarget.dy] });
  const closeOpacity = closeProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  const caption = currentStory.caption;
  // Only the author's own, non-demo stories show the overflow — another
  // person's story never gets a Delete row.
  const canDelete = Boolean(currentStory.isSelf) && !isDemoStory(currentStory);

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
        {
          opacity: closeOpacity,
          transform: [{ translateX: closeTranslateX }, { translateY: closeTranslateY }, { scale: closeScale }],
        },
      ]}
      testID="story-viewer">
      {/* 1. The media: exactly one layer, keyed to this story (+ restart gen). */}
      <View style={StyleSheet.absoluteFill}>
        <StoryMediaLayer
          key={`${currentStory.id}:${generation}`}
          story={currentStory}
          paused={paused}
          onProgress={setProgress}
          onComplete={goToNextStory}
        />
      </View>

      {/* 2. Tap zones sit above the media, below the chrome: left third goes
          back, right two-thirds goes next, and hold either to pause. */}
      <View style={styles.touchArea}>
        <Pressable
          style={styles.leftZone}
          onPress={handleTapPrevious}
          onPressIn={() => setHeld(true)}
          onPressOut={() => setHeld(false)}
          accessibilityRole="button"
          accessibilityLabel="Previous story"
          testID="story-zone-previous"
        />
        <Pressable
          style={styles.rightZone}
          onPress={handleTapNext}
          onPressIn={() => setHeld(true)}
          onPressOut={() => setHeld(false)}
          accessibilityRole="button"
          accessibilityLabel="Next story"
          testID="story-zone-next"
        />
      </View>

      {/* 3. Top chrome — scrim ignores touches itself (box-none); its own
          controls still capture, everything else falls through to the zones. */}
      <LinearGradient
        colors={['rgba(2, 6, 23, 0.7)', 'rgba(2, 6, 23, 0)']}
        style={styles.topScrim}
        pointerEvents="box-none">
        {/* One segment per story in THIS group — never one bar for all. */}
        <View style={styles.progressRow} accessibilityRole="progressbar">
          {group.stories.map((story, index) => (
            <View
              key={story.id}
              style={styles.progressTrack}
              testID={`story-segment-${index}`}
              accessibilityLabel={`Story ${index + 1} of ${group.stories.length}`}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width:
                      index < position.storyIndex
                        ? '100%'
                        : index === position.storyIndex
                          ? `${Math.min(100, Math.max(0, progress * 100))}%`
                          : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>

        <View style={styles.header} pointerEvents="box-none">
          <View style={styles.publisherInfo} pointerEvents="none">
            <Avatar src={group.logoUrl} name={group.name} size={40} />
            <View style={styles.publisherMeta}>
              <View style={styles.nameRow}>
                <Text style={styles.publisherName} numberOfLines={1}>
                  {group.name}
                </Text>
                {isDemo && (
                  <View style={styles.demoChip}>
                    <Text style={styles.demoChipText}>{DEMO_STORY_BADGE}</Text>
                  </View>
                )}
                {group.verified && (
                  <View style={styles.verifiedBadge}>
                    <AppIcon
                      name={{ ios: 'checkmark', android: 'check' }}
                      size={10}
                      color={colors.colorTextOnPrimary}
                    />
                  </View>
                )}
              </View>
              <View style={styles.typeRow}>
                <View style={[styles.typeBadge, premium && styles.typeBadgePremium]}>
                  <Text style={[styles.typeBadgeText, premium && styles.typeBadgeTextPremium]}>
                    {typeLabel}
                  </Text>
                </View>
                <Text style={styles.timeText}>{relTime}</Text>
              </View>
            </View>
          </View>

          {canConnect ? (
            <Pressable
              style={[styles.connectPill, connection.state !== 'none' && styles.connectPillActive]}
              onPress={connection.send}
              disabled={connection.isSending}
              accessibilityRole="button"
              accessibilityState={{ disabled: connection.isSending }}
              accessibilityLabel={`Connection: ${connectLabel}`}
              testID="story-connect">
              <Text style={styles.connectText}>
                {connection.isSending ? 'Sending…' : connectLabel}
              </Text>
            </Pressable>
          ) : null}

          {/* Owner-only overflow: your own non-demo story gets a Delete path;
              another person's story shows Close and nothing else. */}
          {canDelete ? (
            <Pressable
              style={styles.menuButton}
              onPress={() => {
                setDeleteError(null);
                setConfirmingDelete(false);
                setMenuOpen(true);
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Story options"
              testID="story-menu">
              <AppIcon
                name={{ ios: 'ellipsis', android: 'more_vert' }}
                size={22}
                color={colors.colorTextOnPrimary}
              />
            </Pressable>
          ) : null}

          <Pressable
            style={styles.closeButton}
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close story"
            testID="story-close">
            <AppIcon
              name={{ ios: 'xmark', android: 'close' }}
              size={22}
              color={colors.colorTextOnPrimary}
            />
          </Pressable>
        </View>

        {/* Persistent, never a toast: the server's own message plus Retry. */}
        {connection.error ? (
          <View style={styles.connectError} testID="story-connect-error">
            <Text style={styles.connectErrorText} numberOfLines={2}>
              {connection.error}
            </Text>
            <Pressable onPress={connection.dismissError} hitSlop={8}>
              <Text style={styles.connectErrorRetry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </LinearGradient>

      {/* 4. Bottom chrome: caption over a gradient, then the small "See
          details" control — job / internship / event only, never
          announcement. Same box-none rule: the caption never blocks a tap. */}
      <LinearGradient
        colors={['rgba(2, 6, 23, 0)', 'rgba(2, 6, 23, 0.78)']}
        style={styles.bottomScrim}
        pointerEvents="box-none">
        <View style={styles.captionBlock} pointerEvents="none">
          {currentStory.title ? (
            <Text style={styles.titleText} numberOfLines={2} accessibilityRole="header">
              {currentStory.title}
            </Text>
          ) : null}
          {caption ? (
            <Text style={styles.captionText} numberOfLines={4}>
              {caption}
            </Text>
          ) : null}
        </View>

        {showDetails ? (
          opportunity && onOpenOpportunity ? (
            <Pressable
              style={styles.detailsButton}
              onPress={openOpportunity}
              accessibilityRole="button"
              accessibilityLabel={`See details: ${opportunity.title}`}
              testID="story-see-details">
              <Text style={styles.detailsText}>See details</Text>
              <AppIcon
                name={{ ios: 'chevron.right', android: 'chevron_right' }}
                size={14}
                color={colors.colorTextOnPrimary}
              />
            </Pressable>
          ) : (
            // Honest state: the control exists for these types, but V1's story
            // rows carry no `opportunity` yet — no fake navigation, a persistent
            // inline notice instead (AGENTS.md: no invented destinations).
            <View style={styles.detailsColumn}>
              <Pressable
                style={styles.detailsButton}
                onPress={() => {
                  if (storyId) setDetailsStoryId(storyId);
                }}
                accessibilityRole="button"
                accessibilityLabel="See details"
                testID="story-see-details">
                <Text style={styles.detailsText}>See details</Text>
                <AppIcon
                  name={{ ios: 'chevron.right', android: 'chevron_right' }}
                  size={14}
                  color={colors.colorTextOnPrimary}
                />
              </Pressable>
              {detailsNotice ? (
                <View style={styles.detailsNotice} testID="story-details-notice">
                  <Text style={styles.detailsNoticeText}>
                    Details for this story arrive when it is published together with its
                    opportunity. Nothing is linked yet.
                  </Text>
                </View>
              ) : null}
            </View>
          )
        ) : null}
      </LinearGradient>

      {/* Owner-only story menu: Delete with the spec copy, a spinner while the 204 is in flight, and the own message afterwards. */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setMenuOpen(false);
          setConfirmingDelete(false);
        }}
        statusBarTranslucent
        testID="story-menu-dialog">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close story menu"
          onPress={() => {
            setMenuOpen(false);
            setConfirmingDelete(false);
          }}
          style={styles.menuBackdrop}>
          <Pressable
            onPress={() => undefined}
            style={[styles.menuCard, { paddingBottom: insets.bottom + spacing.cardPadding }]}>
            {confirmingDelete ? (
              <View style={styles.menuBody} testID="story-delete-confirm">
                <Text style={styles.menuTitle}>Delete this story permanently?</Text>
                <Text style={styles.menuText}>This action cannot be undone.</Text>
                {deleteError ? (
                  <Text style={styles.menuError} testID="story-delete-error">
                    {deleteError}
                  </Text>
                ) : null}
                <View style={styles.menuRow}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setConfirmingDelete(false)}
                    disabled={deleting}
                    style={styles.menuButtonFlex}
                  />
                  <Button
                    label="Delete"
                    variant="danger"
                    loading={deleting}
                    onPress={() => void handleDeleteStory()}
                    style={styles.menuButtonFlex}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.menuBody}>
                <Text style={styles.menuTitle}>Story options</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete this story. Removes it from the platform permanently."
                  onPress={() => setConfirmingDelete(true)}
                  style={[styles.menuAction, styles.menuActionDanger]}
                  testID="story-delete">
                  <AppIcon
                    name={{ ios: 'trash', android: 'delete' }}
                    size={18}
                    color={colors.colorDanger}
                  />
                  <View style={styles.menuActionText}>
                    <Text style={[styles.menuActionLabel, styles.menuActionLabelDanger]}>Delete</Text>
                    <Text style={styles.menuActionHint}>
                      Removes the story from the platform permanently
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close story menu"
                  onPress={() => {
                    setMenuOpen(false);
                    setConfirmingDelete(false);
                  }}
                  style={[styles.menuAction, styles.menuActionCentered]}>
                  <AppIcon
                    name={{ ios: 'xmark', android: 'close' }}
                    size={18}
                    color={colors.colorTextSecondary}
                  />
                  <Text style={styles.menuActionLabel}>Close</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

/** Absolute-fill coordinates as a plain object — spreadable into styles. */
const absoluteFill = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.colorTextPrimary,
  },
  /** Full-height zones above the media, below the chrome. */
  touchArea: {
    ...absoluteFill,
    flexDirection: 'row',
  },
  leftZone: {
    width: '30%',
    height: '100%',
  },
  rightZone: {
    flex: 1,
    height: '100%',
  },
  topScrim: {
    ...absoluteFill,
    height: 150,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    justifyContent: 'flex-start',
  },
  bottomScrim: {
    ...absoluteFill,
    top: undefined,
    minHeight: 170,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    justifyContent: 'flex-end',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    paddingTop: spacing.xs,
    height: 12,
    alignItems: 'center',
  },
  progressTrack: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.colorTextOnPrimary,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  publisherInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  publisherMeta: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  publisherName: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    flexShrink: 1,
  },
  demoChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
  demoChipText: {
    fontSize: 9,
    fontWeight: typography.fontWeightBold,
    letterSpacing: 0.5,
    lineHeight: 12,
    color: colors.colorTextOnPrimary,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.colorPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  typeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
  typeBadgePremium: {
    backgroundColor: 'rgba(251, 191, 36, 0.22)',
    borderWidth: 1,
    borderColor: colors.colorStoryPremiumBright,
  },
  typeBadgeText: {
    color: colors.colorTextOnPrimary,
    fontSize: 9,
    fontWeight: typography.fontWeightBold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  typeBadgeTextPremium: {
    color: colors.colorStoryPremiumBright,
  },
  timeText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    opacity: 0.85,
  },
  /** Connect: 32 high + 8 vertical hitSlop ≈ 48 — the inline touch floor. */
  connectPill: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'rgba(2, 6, 23, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectPillActive: {
    borderColor: colors.colorTextOnPrimary,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  connectText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
  },
  connectError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  connectErrorText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    flexShrink: 1,
  },
  connectErrorRetry: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightBold,
    textDecorationLine: 'underline',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The overflow button beside Close - the same 44px touch target. */
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* ------------------------------ story menu ------------------------------ */
  menuBackdrop: {
    backgroundColor: colors.colorOverlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.pagePadding,
  },
  menuCard: {
    backgroundColor: colors.colorTextPrimary,
    borderRadius: radius.sheet,
    gap: spacing.md,
    padding: spacing.cardPadding,
  },
  menuBody: { gap: spacing.md },
  menuTitle: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightSemibold,
  },
  menuText: { color: colors.colorTextOnPrimary, opacity: 0.85 },
  menuError: { color: colors.colorDanger },
  menuRow: { flexDirection: 'row', gap: spacing.md },
  menuButtonFlex: { flex: 1 },
  menuAction: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-start',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  menuActionCentered: { justifyContent: 'center' },
  menuActionDanger: { borderColor: colors.colorDanger },
  menuActionText: { flex: 1, gap: 2 },
  menuActionLabel: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
  },
  menuActionLabelDanger: { color: colors.colorDanger },
  menuActionHint: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    opacity: 0.7,
  },
  captionBlock: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
    maxWidth: '100%',
  },
  titleText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightBold,
    textShadowColor: 'rgba(2, 6, 23, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captionText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeBody,
    lineHeight: typography.lineHeightBody,
    textShadowColor: 'rgba(2, 6, 23, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  /** Small, translucent, above the safe area — never a CTA over the story. */
  detailsButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: 'rgba(2, 6, 23, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
  },
  detailsText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightSemibold,
  },
  detailsColumn: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  detailsNotice: {
    borderRadius: radius.sm,
    backgroundColor: 'rgba(2, 6, 23, 0.6)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: 420,
  },
  detailsNoticeText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
    opacity: 0.9,
    textAlign: 'center',
  },
});



