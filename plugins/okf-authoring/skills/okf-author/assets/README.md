# Example OKF v0.2 bundle

`example-bundle/` is a tiny, complete, **conformant OKF v0.2** knowledge bundle,
authored entirely by hand (no OKF binary). Read it or copy it as a starting
scaffold for the `okf-author` skill.

It demonstrates every core feature:

- a bundle-root [`index.md`](example-bundle/index.md) declaring
  `okf_version: "0.2"` (the only legal place for it);
- one concept per non-reserved `.md` file, each with a required non-empty `type`;
- a subdirectory [`index.md`](example-bundle/tables/index.md) with **no**
  frontmatter (only the root index may carry frontmatter);
- bundle-relative markdown links as relationship edges — including one
  intentionally **broken** link (to `/tables/refunds.md`, not yet written) to
  show that broken links are tolerated, not errors;
- the full v0.2 trust vocabulary: `generated`, `verified` (human-reviewed and
  machine-confirmed tiers, **derived**, never stored), `sources` with a per-claim
  footnote citation, `status`, `stale_after`;
- an [Attested Computation](example-bundle/computations/revenue.md) concept
  (`runtime`, `parameters`, `executor`, `attester`) linked from a
  [Metric](example-bundle/metrics/revenue.md);
- a [`log.md`](example-bundle/log.md) update history.

This directory is `assets/`, so its markdown files are example content, not
skills.
