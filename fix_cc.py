content = open('C:/mahaa/src/components/ui/CourseCard.tsx').read()
content = content.replace('tone="primary" testID={`course-skill-${course.id}`}', 'tone="primary"')
content = content.replace('tone="neutral" testID={`course-duration-${course.id}`}', 'tone="neutral"')
content = content.replace(
    "import { colors, radius, spacing, typography } from '@/theme/tokens';",
    "import { colors, layout, radius, spacing, typography } from '@/theme/tokens';"
)
open('C:/mahaa/src/components/ui/CourseCard.tsx', 'w').write(content)
print('fixed')
