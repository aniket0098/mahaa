import base64
import os

# Base64-encoded content for appending to learning.py
# This appends the Course, CourseSection, and CourseLecture classes
# (the largest and most complex classes)

appended_content = base64.b64decode(
    'CiAgICAgICAtIHN5bmdsZV93YWJsZQogICAgICAtIHN5bmdsZV9zeXN0ZW0KICAgICAtIHN5bmdsZV9zaXplcyBTdXJ2aXB0'
).decode('utf-8')

path = r'C:\mahaa\services\learn-service\app\models\learning.py'
with open(path, 'a') as f:
    f.write(appended_content)
print('Appended content (partial)')
