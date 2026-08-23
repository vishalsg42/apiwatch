## What this changes

<!-- One or two sentences. If it changes what apiwatch reports, say whether to expect more
     findings or fewer, since a change in count is otherwise indistinguishable from a bug. -->

## Evidence

<!-- For a rule change, this is the important part.

     Show the code shape before and after, and what apiwatch reports for each. If you measured
     it against a real repository, give the numbers: "N findings became M on <repo>" is worth
     more than any argument about whether the rule is correct.

     Silent suppression is as much a defect as a false positive and harder to notice, so if your
     change makes apiwatch quieter, show what it went quiet on and why that is right. -->

## Checklist

- [ ] `pnpm test` passes
- [ ] `pnpm exec tsc --noEmit` is clean
- [ ] `pnpm exec biome check .` is clean
- [ ] A new or changed rule has a fixture under `test/fixtures/` covering both the firing case
      and the case it must stay silent on
- [ ] If this changes a documented behaviour, the README is updated in the same commit
- [ ] No em dashes (the project uses commas, colons or a rewrite instead)
