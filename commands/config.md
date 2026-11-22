---
description: "Configure PromptBar (e.g. style=dots width=16 color=false). With no arguments, shows the styles"
argument-hint: "[style=bar|blocks|dots|ascii|minimal] [width=N] [showLabel=true|false] ..."
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" config $ARGUMENTS`

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" demo`

Show the user the resulting config (first line) and the style previews verbatim in a code block. Do not run anything else.
