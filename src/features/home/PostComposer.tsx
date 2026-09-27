/**
 * Post composer — the "share an idea" card.
 *
 * Native reproduction of `PostComposer.tsx` + `composer.module.css`.
 *
 * The card is real UI, but publishing has no backend: there is no posts API, so
 * the trigger does not open a sheet that would claim a post was created. It
 * explains that plainly instead, which is what the original compose sheet does
 * ("collects type/title/details but states publishing is not open").
 *
 * On phones the four type shortcuts stay hidden (blueprint §10.2: keep the
 * mobile composer compact) and the avatar + trigger + create action remain — so
 * this renders exactly the same three parts the original renders on a phone.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { styles } from '@/features/home/homeStyles';

export interface PostComposerProps {
  /** The authenticated candidate's real name, headline and avatar. */
  name: string;
  avatarUrl: string | null;
}

export function PostComposer({ name, avatarUrl }: PostComposerProps) {
  const [explained, setExplained] = useState(false);

  return (
    <Card style={styles.composer} testID="post-composer">
      <View style={styles.composerTop}>
        <Avatar name={name} src={avatarUrl} size={40} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share an idea, project, achievement, or learning update"
          style={styles.trigger}
          onPress={() => setExplained((value) => !value)}>
          <AppText variant="body" tone="tertiary">
            Share an idea, project, achievement, or learning update...
          </AppText>
        </Pressable>
      </View>

      {explained ? (
        <StatusBanner
          tone="info"
          title="Publishing is not open yet"
          description="There is no posts API, so nothing you write here could be saved or shared. Your projects, certifications, achievements, and education already appear in your feed below as soon as you add them to your profile."
          onRetry={() => setExplained(false)}
        />
      ) : null}

      <View style={styles.composerBottom}>
        <AppText variant="caption" tone="tertiary">
          Add a record on your profile and it appears in your feed.
        </AppText>
        <Button label="Create Post" onPress={() => setExplained((value) => !value)} />
      </View>
    </Card>
  );
}
