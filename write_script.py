# Minimal Python script to write index.tsx
import sys

# We'll write the content in chunks
content_parts = []

def append(content):
    content_parts.append(content)

# ... the full content will be added in subsequent calls

# Write the final file
output_path = r'C:\mahaa\src\app\(candidate)\learn\index.txt'
with open(output_path, 'w', encoding='utf8') as f:
    for part in content_parts:
        f.write(part)
print('Script executed, wrote', output_path)
# Chunk 2: content generation setup
append('''content_parts = []

def append(content):
    content_parts.append(content)

# Chunk 1: imports and constants (already added above)

# Chunk 2: Full index.tsx content as a Python raw string
index_content = r'''/*

 * Learning Hub — Home: the Lectures screen.

 * Premium learning home: a featured hero banner, Recommended lectures,
 * Popular Topics, a working demo playlist, and the full All Lectures
 * catalogue — all backed by real server rows.

 * Data spine, all real server rows:
 *  - GET /courses — the catalogue page (q = search, category = topic filter)
 *  - GET /courses/{id} for a bounded slice — the only way the server
 *    exposes lectures (there is no lecture-feed endpoint).

 * There is no lecture-feed endpoint, no popularity counts, and no comments
 * API on the server. The Trending band is honestly labeled Recommended;
 * topics are derived from real course categories; the playlist is a clearly
 * labeled demo. Nothing here is invented.
 */''')
''')
content_parts = []

def append(content):
    content_parts.append(content)

# Chunk 1: imports and constants
append('''/**

 * Learning Hub — Home: the Lectures screen.

 * Premium learning home: a featured hero banner, Recommended lectures,
 * Popular Topics, a working demo playlist, and the full All Lectures
 * catalogue — all backed by real server rows.

 * Data spine, all real server rows:
 *  - GET /courses — the catalogue page (q = search, category = topic filter)
 *  - GET /courses/{id} for a bounded slice — the only way the server
 *    exposes lectures (there is no lecture-feed endpoint).

 * There is no lecture-feed endpoint, no popularity counts, and no comments
 * API on the server. The Trending band is honestly labeled Recommended;
 * topics are derived from real course categories; the playlist is a clearly
 * labeled demo. Nothing here is invented.
 */''')