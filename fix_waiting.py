import re

with open('apps/web/src/app/session/onboarding/page.tsx', 'r') as f:
    content = f.read()

# Replace block 1 (countdown)
block1_regex = r'\{currentStage === 15 && contestWindow && waitMs > 0 && \(\s*<div\s*style=\{\{\s*border: "1px solid rgba\(168,85,247,0\.32\)",\s*background: "rgba\(168,85,247,0\.08\)",\s*borderRadius: 12,\s*padding: "18px 16px",\s*color: "#ddd6fe",\s*textAlign: "center",\s*\}\}\s*>\s*<div style=\{\{ fontSize: 18, fontWeight: 700, marginBottom: 8 \}\}>\s*Verification complete\s*</div>\s*<div style=\{\{ fontSize: 13, color: "#c4b5fd", marginBottom: 8 \}\}>\s*Contest starts in \{formatCountdown\(waitMs\)\} \(\{contestWindow\.timezone \|\| "UTC"\}\)\s*</div>\s*<div style=\{\{ fontSize: 12, color: "#a1a1aa" \}\}>\s*You will be redirected automatically at start time\.\s*</div>\s*</div>\s*\)'

block1_replacement = '''{currentStage === 15 && contestWindow && waitMs > 0 && (
                <div
                  style={{
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    background: "#0F0F0F",
                    borderRadius: 0,
                    padding: "32px 32px",
                    textAlign: "left",
                    fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", rowGap: "14px", fontSize: "13px", alignItems: "center" }}>
                    <div style={{ color: "#A8A8A8" }}>[SYS_STATE]</div>
                    <div style={{ color: "#22c55e" }}>VERIFICATION_COMPLETE</div>
                    
                    <div style={{ color: "#A8A8A8" }}>[TARGET]</div>
                    <div style={{ color: "#FFF" }}>AMS_DERIVE_EXECUTION_NODE</div>
                    
                    <div style={{ color: "#A8A8A8" }}>[HOOKS]</div>
                    <div style={{ color: "#FFF" }}>ARMED_AND_LOCKED</div>
                    
                    <div style={{ color: "#A8A8A8" }}>[ACTION]</div>
                    <div style={{ color: "#a855f7" }}>AWAITING_AUTO_REDIRECT...</div>

                    <div style={{ gridColumn: "1 / -1", height: "1px", background: "rgba(255,255,255,0.05)", margin: "16px 0 8px 0" }} />

                    <div style={{ color: "#A8A8A8" }}>[T-MINUS]</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                      <span style={{ fontSize: "42px", fontWeight: 700, color: "#FFFFFF", lineHeight: 1, letterSpacing: "-0.02em" }}>
                        {formatCountdown(waitMs)}
                      </span>
                      <span style={{ fontSize: "13px", color: "#A8A8A8" }}>
                        ({contestWindow.timezone || "UTC"})
                      </span>
                    </div>
                  </div>
                </div>
              )}'''

# Replace block 2 (launching)
block2_regex = r'\{currentStage === 15 && \(\!contestWindow \|\| waitMs <= 0\) && \(\s*<div\s*style=\{\{\s*border: "1px solid rgba\(168,85,247,0\.2\)",\s*background: "rgba\(168,85,247,0\.05\)",\s*borderRadius: 12,\s*padding: "28px 16px",\s*textAlign: "center",\s*\}\}\s*>\s*<div\s*style=\{\{\s*width: 32,\s*height: 32,\s*border: "2px solid rgba\(168,85,247,0\.3\)",\s*borderTopColor: "#a855f7",\s*borderRadius: "50%",\s*animation: "spin 0\.9s linear infinite",\s*margin: "0 auto 16px",\s*\}\}\s*/>\s*<div style=\{\{ fontSize: 15, fontWeight: 600, color: "#ddd6fe", marginBottom: 6 \}\}>\s*Launching Contest\s*</div>\s*<div style=\{\{ fontSize: 13, color: "#a1a1aa" \}\}>\s*Entering secure session&hellip;\s*</div>\s*</div>\s*\)'

block2_replacement = '''{currentStage === 15 && (!contestWindow || waitMs <= 0) && (
                <div
                  style={{
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    background: "#0F0F0F",
                    borderRadius: 0,
                    padding: "32px 32px",
                    textAlign: "left",
                    fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", rowGap: "14px", fontSize: "13px", alignItems: "center" }}>
                    <div style={{ color: "#A8A8A8" }}>[SYS_STATE]</div>
                    <div style={{ color: "#22c55e" }}>VERIFICATION_COMPLETE</div>
                    
                    <div style={{ color: "#A8A8A8" }}>[TARGET]</div>
                    <div style={{ color: "#FFF" }}>AMS_DERIVE_EXECUTION_NODE</div>
                    
                    <div style={{ color: "#A8A8A8" }}>[HOOKS]</div>
                    <div style={{ color: "#FFF" }}>ARMED_AND_LOCKED</div>
                    
                    <div style={{ color: "#A8A8A8" }}>[ACTION]</div>
                    <div style={{ color: "#a855f7", display: "flex", alignItems: "center", gap: "8px" }}>
                      LAUNCHING_SECURE_SESSION...
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          border: "2px solid rgba(168,85,247,0.3)",
                          borderTopColor: "#a855f7",
                          borderRadius: "50%",
                          animation: "spin 0.9s linear infinite",
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}'''


content = re.sub(block1_regex, block1_replacement, content, flags=re.DOTALL)
content = re.sub(block2_regex, block2_replacement, content, flags=re.DOTALL)

with open('apps/web/src/app/session/onboarding/page.tsx', 'w') as f:
    f.write(content)
