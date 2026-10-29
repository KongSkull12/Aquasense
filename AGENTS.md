# AquaSense Codex Instructions

## Project

AquaSense is an IoT-based water quality monitoring and automated
feeding management system.

Before changing code, inspect the existing implementation and
understand how the affected components currently work.

## General Rules

- Inspect relevant files before modifying code.
- Preserve the existing project architecture unless a change is justified.
- Prefer small and focused changes.
- Do not modify unrelated files.
- Do not create duplicate implementations when an existing one can be reused.
- Do not expose secrets, credentials, API keys, or tokens.
- Never commit `.env` files.
- Preserve existing user work whenever possible.
- Explain important architectural assumptions.

## Git Safety

Before making significant changes:

- Check `git status`.
- Identify the current branch.
- Preserve unrelated modified files.
- Do not switch branches unless requested.
- Do not commit automatically unless explicitly requested.
- Do not push automatically unless explicitly requested.

Never include:

- `.env`
- credentials
- API keys
- passwords
- tokens

## Code Quality

When modifying code:

- Prefer the smallest correct change.
- Follow the existing coding style.
- Avoid unnecessary rewrites.
- Keep TypeScript types explicit where useful.
- Handle errors and invalid input properly.
- Preserve backward compatibility when practical.

## Validation

After changes, use the project's available validation tools when appropriate.

Examples include:

- TypeScript type checking
- builds
- tests
- linting

Do not claim that something works unless it was reasonably verified.

## Subagents

Use specialized subagents when their role clearly matches the task.

When delegating:

- Give each subagent one clearly defined responsibility.
- Avoid giving multiple agents ownership of the same files.
- Prefer parallel agents for independent investigation tasks.
- Wait for relevant agents to finish before combining conclusions.
- Summarize important findings in the main thread.

For exploration and reviews, prefer read-only subagents.