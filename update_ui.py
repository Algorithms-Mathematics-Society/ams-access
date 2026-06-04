import re

with open("apps/web/src/app/session/contest/client.tsx", "r") as f:
    content = f.read()

# 1. Import ChevronUp, ChevronDown
if "ChevronUp" not in content:
    content = content.replace("ChevronRight,", "ChevronRight,\n  ChevronUp,\n  ChevronDown,")

# 2. Replace ▲ and ▼ controls
content = content.replace('{isExpanded ? "▲" : "▼"}', '{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}')

# 3. Fix small icon buttons to 32px square
content = content.replace('width: "28px",\n                      height: "28px",', 'width: "32px",\n                      height: "32px",')
# Let's find other small buttons and toolbars using regex or replace specific ones if they are obvious
# "2px" to "8px" for panels/cards/modals
content = content.replace('borderRadius: "2px"', 'borderRadius: "8px"')
content = content.replace('borderRadius: "2px 2px 0 0"', 'borderRadius: "8px 8px 0 0"')

# Change 24px filter tabs to 32px? "Toolbars: 32-36px controls."
# I'll change the 24px test result filters to 28px or 32px
content = content.replace('height: "24px",\n                                  padding: "0 9px",', 'height: "28px",\n                                  padding: "0 12px",')

# Main actions: height 36-40px. Let's make Submit Solution and Run 40px
content = content.replace('height: "36px",\n                      display: "inline-flex",\n                      alignItems: "center",\n                      justifyContent: "center",\n                      gap: "8px",', 'height: "40px",\n                      display: "inline-flex",\n                      alignItems: "center",\n                      justifyContent: "center",\n                      gap: "8px",')

with open("apps/web/src/app/session/contest/client.tsx", "w") as f:
    f.write(content)

print("Done")
