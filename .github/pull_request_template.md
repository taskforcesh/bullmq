<!--
  Thank you for submitting a PR! 
  Please fill out all sections below to help us understand your changes.

  PR TITLE FORMAT
  ───────────────
  We use Conventional Commits: <type>(<scope>): <description>

  If your change affects one or more ports, append a tag at the end of the
  PR title (outside the conventional-commit part) to indicate their status:

    [python] / [elixir] / [php]
      → The change is ONLY relevant to that port (Node.js is NOT affected).
        Multiple ports can be listed: [python][elixir]

    (python) / (elixir) / (php)
      → The change affects that port AND Node.js.
        Multiple ports can be listed: (python)(php)

  Examples:
    fix(worker): handle stalled jobs correctly (python)(elixir)
    docs: update rate-limiting guide [python]
    feat(queue): add group priority support

  Please check all three ports below before setting your title.
-->

### Port Impact Checklist
<!--
  Review each port and tick every box that applies.
  If a port is not affected at all, leave its box unchecked.
-->

- [ ] **Python** – does this change need to be ported or documented in the Python library?
- [ ] **Elixir** – does this change need to be ported or documented in the Elixir library?
- [ ] **PHP** – does this change need to be ported or documented in the PHP library?

### Why
<!-- 
  1. Why is this change necessary?
  2. What problem does it solve or improve?
  3. Link to any relevant issues, if applicable.
-->
_Enter your explanation here._

### How
<!--
  1. How did you implement this?
  2. Outline the approach or steps taken.
  3. List any resources or documentation that helped you.
-->
_Enter the implementation details here._

### Additional Notes (Optional)
<!--
  Use this space for additional considerations: 
  - Potential side effects
  - Dependencies 
  - Testing instructions
  - Anything else reviewers should know
-->
_Any extra info here._
