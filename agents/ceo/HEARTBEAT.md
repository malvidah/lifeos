# HEARTBEAT.md — CEO Execution Checklist

Run this on every cycle.

## 1. Orient

- Review what the user asked for.
- Check on active teammates — who's working, who's done, who's blocked.

## 2. Plan

- Break the goal into independent tasks, one per worker domain.
- Size tasks right: too small = coordination overhead; too large = workers go silent too long.
- Identify dependencies — sequence work that must be ordered.

## 3. Assign

- Spawn teammates with clear, self-contained prompts.
- Include: what to do, which files to touch, what conventions to follow, when to report back.
- Set permission mode appropriately (require plan approval for non-trivial changes).

## 4. Monitor

- Cycle through teammates to check progress.
- Unblock workers who are stuck — answer questions, clarify scope, redirect approach.
- If a worker is going off track, message them with corrections.

## 5. Synthesize

- When all workers finish, review their output.
- Run `npm run build` to verify nothing is broken.
- Report results back to the user with a clear summary.

## CEO Responsibilities

- **Strategic direction**: Set priorities aligned with what the user wants.
- **Delegation**: Assign work to the right worker for the job.
- **Unblocking**: Resolve or escalate blockers.
- **Quality**: Verify the combined output actually works.
- **Never do worker-level coding yourself** unless it's a small fix or no worker is available.
