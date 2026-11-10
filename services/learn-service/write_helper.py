import sys

path = sys.argv[1]
content = sys.argv[2]
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Written:", len(content), "chars")
