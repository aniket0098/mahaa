import fs from 'node:fs';
function dump(p, a, b) {
  const s = fs.readFileSync(p, 'utf8');
  const lines = s.split('\n');
  console.log('=== ' + p + ' total ' + lines.length);
  console.log(lines.slice(a - 1, b).map((l, i) => (a + i) + ':' + l).join('\n'));
}
dump('C:/mahaa/src/app/(candidate)/conversation/[id].tsx', 1, 60);
dump('C:/mahaa/src/app/(candidate)/conversation/[id].tsx', 1205, 1235);
dump('C:/mahaa/src/app/(candidate)/conversation/[id].tsx', 1450, 1480);
dump('C:/mahaa/src/app/(candidate)/conversation/[id].tsx', 1795, 1815);
dump('C:/mahaa/src/app/(candidate)/_layout.tsx', 50, 70);
dump('C:/mahaa/src/features/conversation/conversationSafeArea.test.ts', 110, 130);
dump('C:/mahaa/src/features/composer/composerSafeArea.test.ts', 1, 80);
