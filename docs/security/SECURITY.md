# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in ctxhub, please report it by email to **security@ctxhub.dev**. Do not open a public GitHub issue.

We will acknowledge receipt within **48 hours** and provide an initial assessment within **5 business days**. We will keep you informed as we work on a fix.

## Responsible disclosure

We ask that you:

- Give us reasonable time to investigate and fix the issue before public disclosure
- Do not access, modify, or delete data belonging to other users
- Do not perform denial-of-service attacks

We will not take legal action against researchers who follow these guidelines and report in good faith.

Once a fix is released, we will credit the reporter in the release notes unless they prefer to remain anonymous.

## Scope

In scope:

- The ctxhub CLI (`src/`)
- The ctxhub HTTP service (`src/service/`)
- The MCP server (`src/mcp/`)
- The auth and RBAC implementation (`src/auth/`)
- The cloud sync protocol (`src/cloud/`)

Out of scope:

- Vulnerabilities in third-party dependencies (report those to the relevant upstream project; we will apply patches promptly)
- Issues that require physical access to the developer's machine
- Social engineering

## Bug bounty

ctxhub does not currently operate a paid bug bounty programme. We recognise and thank researchers in release notes for valid, responsibly disclosed vulnerabilities.

## Contact

security@ctxhub.dev
