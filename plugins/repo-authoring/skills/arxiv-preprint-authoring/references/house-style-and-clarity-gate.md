# House-Style and Clarity Gate (`Syntaxis` & Editorial Standards)

This reference defines the mandatory prose and clarity rules for academic preprints and technical manuscripts. Every draft must pass these checks before publication.

---

## 1. Prohibited Rhetorical Devices

1. **Zero Em-Dashes (`—`) in Prose:**
   - Do not use `—` (U+2014) anywhere in abstract, body paragraphs, list items, or figure/table captions.
   - *Why:* Models overuse em-dashes as a generic rhetorical splice instead of specifying whether the second clause is a causal explanation (use a colon `:`), a coordinate independent clause (use a semicolon `;`), or a parenthetical aside (use parentheses `(...)`).
2. **Zero Throat-Clearing Openers:**
   - Ban openers that delay the subject and verb:
     - *"It is important to note that..."*
     - *"It is worth mentioning that..."*
     - *"In the rapidly evolving landscape of..."*
     - *"Needless to say..."*
   - *Fix:* Delete the preamble and begin directly with the actor and action.
3. **Zero Lazy Binary-Contrast Frames (`"Not X, but Y"`):**
   - Avoid formulaic contrast templates such as *"This is not merely X, it is Y"* or *"The goal is not to X, but rather to Y"* unless contrasting two formal mathematical definitions ($P = 0$ vs. $\mathcal{T} = 1$).
4. **Zero Unanchored Evaluative Adjectives:**
   - Never write *"stunning improvement"*, *"massive speedup"*, or *"dramatic reduction"* without immediately binding the noun phrase to the exact numeric multiplier and baseline comparison in the same sentence (for example: *"cuts wall-clock latency by $4.23\times$ (54.10s vs. 229.02s)"*).

---

## 2. Active Voice & Named Actors

Every sentence describing system behavior or experimental methodology must name the concrete actor:
- **Weak (Passive / Unattributed):** *"Candidate outputs are validated and errors are fixed in subsequent turns."*
- **Strong (Named Actor):** *"In Conditions C and D, the executor $M$ invokes `run_validator` on workspace $W_k$, receives line-level AST diagnostics from oracle $V$, and patches the offending struct field in Turn $k+1$."*

---

## 3. Readability & Audience Calibration

- **Target Grade Band:** Flesch-Kincaid Grade **12.0 to 14.5** (Academic / Systems Research).
- **Paragraph Unity:** Each paragraph opens with a declarative topic sentence stating the claim, develops the formal or empirical mechanism in the middle sentences, and closes with the quantitative consequence or table/figure reference.
