const fs = require('fs');
const p = 'c:\\mahaa\\src\\app\\(candidate)\\learn\\index.tsx';
let c = fs.readFileSync(p, 'utf8');
let before = c;

// Fix 1: Remove backslash-escaped quotes: \" -> "
c = c.replace(/\\"/g, '"');

// Fix 2: Unquoted attribute values -> quoted
c = c.replace(/title=Lectures\b/g, 'title="Lectures"');
c = c.replace(/title=Could not load lectures\b/g, 'title="Could not load lectures"');
c = c.replace(/title=Recommended\b/g, 'title="Recommended"');
c = c.replace(/title=Popular Topics\b/g, 'title="Popular Topics"');
c = c.replace(/title=Lecture Playlists\b/g, 'title="Lecture Playlists"');
c = c.replace(/title=All Lectures\b/g, 'title="All Lectures"');

c = c.replace(/kicker=LEARNING HUB\b/g, 'kicker="LEARNING HUB"');

c = c.replace(/description=Picked for you from the catalogue/g, 'description="Picked for you from the catalogue"');
c = c.replace(/description=Browse lectures by topic/g, 'description="Browse lectures by topic"');
c = c.replace(/description=Guided sequences of lessons/g, 'description="Guided sequences of lessons"');

c = c.replace(/accessibilityLabel=See all lectures\b/g, 'accessibilityLabel="See all lectures"');
c = c.replace(/accessibilityLabel=See all topics\b/g, 'accessibilityLabel="See all topics"');
c = c.replace(/accessibilityLabel=Open full catalogue\b/g, 'accessibilityLabel="Open full catalogue"');

c = c.replace(/testID=lectures-header\b/g, 'testID="lectures-header"');

c = c.replace(/accessibilityRole=button\b/g, 'accessibilityRole="button"');
c = c.replace(/accessibilityLabel={Topic courses}/g, 'accessibilityLabel={chip.name}');
c = c.replace(/testID={\\topic-chip-}/g, 'testID={`topic-chip-${chip.id}`}');

c = c.replace(/variant=small\b/g, 'variant="small"');
c = c.replace(/weight=semibold\b/g, 'weight="semibold"');
c = c.replace(/weight=medium\b/g, 'weight="medium"');
c = c.replace(/tone=secondary\b/g, 'tone="secondary"');
c = c.replace(/variant=h3\b/g, 'variant="h3"');

// Fix 3: Broken template literal: description={\${allItems.length} lecture in the catalogue}
c = c.replace(/description={\$\{allItems\.length\} lecture in the catalogue}/g, 'description={\`${allItems.length} lecture${allItems.length === 1 ? "" : "s"} in the catalogue\`}');

// Fix 4: label=Reset filters, variant=secondary
c = c.replace(/label=Reset filters\b/g, 'label="Reset filters"');
c = c.replace(/variant=secondary\b/g, 'variant="secondary"');

fs.writeFileSync(p, c, 'utf8');
console.log('Total replacements applied');
console.log('Changed: ' + (before !== c));