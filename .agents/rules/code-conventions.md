---
description: Project-wide code conventions that apply regardless of which part of the stack you are touching.
activation: always
---

# Code Conventions

## 1. Language: English in the code, always

All code comments, docstrings, log/print output, commit messages, CLI help text,
and identifiers must be written in **English** — in every language used in this
project (Python, TypeScript, SQL, shell).

This holds even when the surrounding conversation, issue, or review is in German.
Discussion language and code language are independent: talk in whatever language
suits the people involved, but what lands in the repository stays English.

**Why:** the codebase is public (MIT licensed) and contributor-facing. Mixed-language
comments make files harder to read, break `grep` for domain terms, and put a barrier
in front of anyone who joins later.

**Applies to Markdown too** for documentation that describes the system itself —
`README.md`, the `ARCHITECTURE.md` files, and these rules. Personal working notes
and planning documents may be in German if that is more useful to their author.

## 2. Match the surrounding style

Comment density, naming patterns, and idiom should follow the file you are editing
rather than a personal preference. A file that explains *why* in short comments
should not suddenly acquire long tutorial-style blocks.
