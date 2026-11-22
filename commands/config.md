---
description: "Configure PromptBar (e.g. layout=compact measure=both barStyle=dots, or reset). With no arguments, previews every layout"
argument-hint: "[layout=default|verbose|compact|minimal|countdown|focus|plain] [measure=time|percent|both] [key=value ...] | reset"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" config $ARGUMENTS`

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" demo`

Show the user any notes or errors, the resulting config, and the layout previews verbatim in a code block. Do not run anything else.
