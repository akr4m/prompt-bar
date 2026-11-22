
=== PLAN_BEFORE_CODING rules ===

Before planning or writing code, first investigate the existing codebase thoroughly.

Your goal is to reach a complete shared understanding of the implementation plan before any coding begins. Walk through the design tree step by step, resolving dependencies between decisions in the correct order.

- **Ask clarifying questions relentlessly** about implementation choices, edge cases, assumptions, tradeoffs, and design constraints. Ask only one question at a time.
- **Provide recommendations:** For every question you ask, also provide your recommended answer and explain briefly why it is the best choice.
- **Explore before asking:** Do not ask me anything that can be answered by inspecting the codebase. Explore the codebase first, infer what you can, and only ask when human judgment or product intent is required.
- **Use the right tools:** Use the `UserQuestion` tool for all clarifying questions.
- **Wait for clarity:** Do not start implementation until all critical decisions are resolved and the plan is mutually clear.

=== core rules ===

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
