# LifeOS — Claude Code Guidelines

## Project
- Next.js app (App Router) with Supabase backend
- Auto-deploys to Vercel on push to `main`
- Run `npm run dev` for local dev, `npm run build` to verify

## How To Start Every Task

**ALWAYS follow this order. Do not skip steps.**

### Step 1: PLAN FIRST (mandatory)
- Before writing ANY code, enter plan mode
- Read the relevant files and understand what exists
- Write out your plan: what files you'll change, what the changes are, and why
- Share the plan with the user and get approval before proceeding
- If the task is small (< 5 lines changed), you can state the plan briefly inline

### Step 2: CHECK WHAT OTHER AGENTS ARE DOING
- Ask the user: "Are any other agents working on related files?"
- If you're unsure, run `git fetch origin && git branch -r | grep agent/` to see active branches
- Do NOT touch files another agent is working on

### Step 3: CODE
- Work on your branch only
- Commit often with clear messages
- Run `npm run build` after significant changes to catch errors early

### Step 4: MERGE
- When done, use `/safe-merge` to safely merge to main
- This builds, rebases, checks for conflicts, and pushes

## Parallel Agent Workflow
This project uses multiple Claude Code agents working in parallel on separate git worktrees.

### Worktree locations
| Agent | Directory | Branch |
|-------|-----------|--------|
| 1 | `/Users/mali/lifeos-agent-1` | `agent/worker-1` |
| 2 | `/Users/mali/lifeos-agent-2` | `agent/worker-2` |
| 3 | `/Users/mali/lifeos-agent-3` | `agent/worker-3` |
| 4 | `/Users/mali/lifeos-agent-4` | `agent/worker-4` |
| main | `/Users/mali/lifeos` | `main` |

### Rules for all agents
1. **Work on your own branch only.** Never switch to another agent's branch.
2. **Before merging to main**, use `/safe-merge` — it builds, rebases, and pushes safely.
3. **After another agent merges to main**, run `git fetch origin main && git rebase origin/main` to stay current.
4. **Don't edit the same files** as another agent without coordinating with the user first.
5. **Never force push to main.**
6. **Plan before coding.** Always share your plan before writing code.
7. **Commit early and often.** Small commits are easier to merge.

## Code conventions
- Use existing patterns in the codebase — don't introduce new frameworks or libraries without asking
- Keep components in `components/`, API routes in `app/api/`, utilities in `lib/`
