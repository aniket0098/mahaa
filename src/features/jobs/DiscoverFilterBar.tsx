/**
 * Work-mode control — a segmented picker for the single filter dimension the
 * API accepts (`work_mode`: remote | hybrid | onsite), plus an explicit "Any".
 *
 * It is a segmented control rather than loose chips or a bottom sheet because
 * the whole dimension is four mutually exclusive options: one always-visible
 * row beats both a chip group (no visible neutral state) and a modal (the
 * LinkedIn critique's "filters hidden behind a modal, reset every session").
 * Tapping the active segment returns to "Any", so the reset is one tap and the
 * control is never ambiguous.
 *
 * Exposed as a radio group: each option is a `radio` with a `selected` state,
 * never signalled by colour alone. No salary, experience, industry, skill or
 * location filter is offered — `GET /opportunities` supports none of them, and
 * a control that cannot change the results is worse than no control.
 */

import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import type { WorkMode } from '@/types/opportunity';

import { WORK_MODE_LABELS } from './discoverFilters';
import { styles } from './discoverStyles';

/** The four options: "Any" is `null` (no `work_mode` sent), the rest map 1:1. */
const WORK_MODE_OPTIONS: readonly { value: WorkMode | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 'remote', label: WORK_MODE_LABELS.remote },
  { value: 'hybrid', label: WORK_MODE_LABELS.hybrid },
  { value: 'onsite', label: WORK_MODE_LABELS.onsite },
];

export interface DiscoverFilterBarProps {
  workMode: WorkMode | null;
  onWorkModeChange: (workMode: WorkMode | null) => void;
}

export function DiscoverFilterBar({ workMode, onWorkModeChange }: DiscoverFilterBarProps) {
  return (
    <View
      style={styles.segmentedTrack}
      accessibilityRole="radiogroup"
      accessibilityLabel="Work mode">
      {WORK_MODE_OPTIONS.map((option) => {
        const active = workMode === option.value;
        return (
          <Pressable
            key={option.label}
            onPress={() => onWorkModeChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              option.value === null ? 'Any work mode' : `${option.label} work mode`
            }
            style={[styles.segmented, active ? styles.segmentedActive : null]}>
            <AppText
              variant="small"
              weight={active ? 'semibold' : 'medium'}
              tone={active ? 'primary' : 'secondary'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

