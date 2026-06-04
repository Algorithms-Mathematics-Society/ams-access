import re

with open("apps/web/src/app/session/contest/client.tsx", "r") as f:
    text = f.read()

# Replace all 28px width/height buttons with 32px
text = re.sub(r'width:\s*"28px",\s*height:\s*"28px",', 'width: "32px",\n                                  height: "32px",', text)

with open("apps/web/src/app/session/contest/client.tsx", "w") as f:
    f.write(text)
