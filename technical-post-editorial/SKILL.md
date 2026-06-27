---
name: technical-post-editorial
description: Edit technical blog posts to remove AI writing patterns and preserve human voice. Use when drafting or reviewing developer-facing posts, migration guides, and engineering write-ups.
metadata:
  trigger: Reviewing or editing a technical blog post draft
  sources:
    - stop-slop skill (hardikpandya/stop-slop) — pattern rules
    - Ruth Starkman, "Model Style Is So Cringe" (Substack, March 2026) — nuance on device vs lazy use
---

# Technical Post Editorial

Remove AI writing patterns from technical prose. The goal is not to strip out stylistic devices — it is to make sure every device earns its place.

## The Core Tension (from Ruth Starkman)

The problem with model prose isn't the devices themselves — em dashes can be precise, contrast can clarify, a rule of three can organize. The problem is using them before you've specified the actor, the relation, the limit, or the claim. A model produces the *rhetoric* of argument before the argument exists.

Two failure modes:
1. **Lazy use**: device before substance (the diagnosis)
2. **Overcorrection**: removing every marked choice because a model might have used it (let the model set the terms anyway)

The test for any device: does this clarify a specific claim, or does it signal that a claim is about to appear?

---

## Rules

### 1. No em dashes in prose

Em dashes are the primary tell. Readers identify them on sight now.

- No `—` in prose sentences. Use a comma, a colon, a period, or a parenthetical.
- Exception: code and tables.

### 2. Active voice, named actors

Every sentence needs a human or a named system doing something. Passive voice and false agency hide the actor.

| Avoid | Fix |
|---|---|
| "The migration is loud about what broke" | "We've covered what broke" |
| "The config was changed" | "We changed the config" |
| "The data tells us" | "The numbers show" |

### 3. No adverbs

Kill all -ly words. No softeners, intensifiers, or hedges. Specific offenders: "notably," "genuinely," "silently," "actually," "simply," "truly," "deeply," "fundamentally."

Exception: adverbs inside code comments or technical specifications where precision requires them.

### 4. No throat-clearing openers

Cut the announcement before the point.

- "Here's the thing:" → cut, state the thing
- "Here's what we found:" → cut, state what you found
- "It's worth noting that" → cut, state the note
- "It turns out" → cut
- "The payoff:" as a standalone label → merge into the sentence

### 5. No binary contrasts as the frame

"Not X, it's Y" and "X isn't the problem, Y is" are the loudest model tells in analytical prose. They manufacture drama. State Y.

- "Not `click_at`. Just `click`." → "The model emits `click` now, not `click_at`."
- "`Environment` isn't documentation, it's behavior." → "`Environment` changes model behavior."
- "Migrating isn't only about not breaking." → "Migration adds capabilities too."

### 6. No staccato fragmentation

Sentence fragments for emphasis read as manufactured profundity. "That's it. That's the thing." — complete sentences.

### 7. No Wh- sentence starters

Sentences starting with What, When, Where, Which, Who, Why, How tend to become rhetorical.

- "What cost us the extra day was..." → "The extra day came from..."
- "What makes this hard is..." → "The constraint is..."

### 8. Vary rhythm, no metronomic three-item lists

Two items beat three. Three consecutive similarly-structured sentences need a break. Paragraphs shouldn't all end punchily.

### 9. No vague declaratives

A sentence that announces significance without naming the specific thing is empty.

- "This is the single decision that made the migration painless" → show the decision, skip the annotation
- "The implications are significant" → name the implication

### 10. Trust the reader

Skip hand-holding, softening, meta-commentary, and permission-granting. "And that's okay." No. State the fact, let readers conclude.

---

## Technical Writing-Specific Exceptions

These stop-slop rules apply to *prose* paragraphs. The following are acceptable in technical posts:

- Em dashes as separators inside bulleted lists (markdown convention)
- Three-item lists when the items are genuinely enumerable and distinct (not rhetorical)
- Passive voice in code comments where the actor is genuinely unspecified
- Technical adverbs that carry precision: "atomically," "synchronously," "recursively"

---

## Scoring (from stop-slop)

Rate 1–10 on each:

| Dimension | Question |
|---|---|
| Directness | Statements, not announcements? |
| Rhythm | Varied, not metronomic? |
| Trust | Respects reader intelligence? |
| Authenticity | Sounds like a person who did the thing? |
| Density | Anything cuttable? |

Below 35/50: revise.

---

## Common Patterns in Technical Posts

These appear frequently in engineering write-ups and are easy to miss:

| Pattern | Fix |
|---|---|
| "Worth noting:" | Cut. State the note. |
| "Worth confirming rather than assuming" | "Confirm, don't assume." |
| "Cheap insurance against..." | State what it prevents, specifically. |
| "The obvious fix is X. We did something better." | State the approach directly. |
| Italicizing a word for emphasis ("it mattered *more*") | Remove. Rewrite if emphasis is needed. |
| "The lesson that cost us the most time" | Fine as a heading, but the paragraph should open with the lesson, not with the meta-commentary about it costing time. |
