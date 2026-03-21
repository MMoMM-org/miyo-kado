#!/bin/bash
CONTEXT=$(cat)
STRONG="fixed|workaround|gotcha|discovered|realized|turns out|decided|changed|installed|configured"
WEAK="error|bug|issue|problem|failed"

if echo "$CONTEXT" | grep -qiE "$STRONG"; then
    cat << 'EOF'
{"decision":"approve","systemMessage":"Session had fixes/decisions/discoveries. Run /reflect to capture learnings."}
EOF
elif echo "$CONTEXT" | grep -qiE "$WEAK"; then
    echo '{"decision":"approve","systemMessage":"Learned something non-obvious? Run /reflect to update docs."}'
else
    echo '{"decision":"approve"}'
fi
