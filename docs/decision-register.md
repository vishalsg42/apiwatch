# Decision Register: apiwatch Next Steps

**Date Pre-registered:** 2026-08-29
**Evaluation Date:** 2026-09-15

## The Stop Condition

By 2026-09-15, success is defined as achieving **at least 2** of the following 3 signals:

1. **Upstream PR Merged:** At least one upstream PR (e.g., to novu or Jukebox-Server) that fixes a missing timeout found by apiwatch is merged by the maintainers.
2. **External Issue:** At least one external issue is opened on the apiwatch repository by a user (must be a substantive issue or feature request, not a typo fix).
3. **Organic Adoption:** At least one repository (other than those owned by the author) is found using apiwatch in their CI/CD or package.json, discoverable via GitHub code search.

If fewer than 2 of these signals are met by the evaluation date, apiwatch will be archived as a completed experiment. No further product code (ESLint plugin, NestJS CLI reports) will be written.

## What Does NOT Count

To prevent rationalizing failure, the following metrics explicitly **do not count** towards the success threshold:
* npm download counts (too easily skewed by bots/scanners).
* GitHub stars (vanity metric, does not indicate usage).
* Any traffic, runs, or logs originating from this account's own CI workflows.

## Results Log

* **Novu PR:** [Link pending] - Status: [Pending] - Maintainer response: [Pending]
* **Jukebox-Server PR:** [Link pending] - Status: [Pending] - Maintainer response: [Pending]
* **Publishing the negative result:** [Link pending] - Status: [Pending]

## Final Decision
*To be filled on 2026-09-15*
