# Security policy

Take One records screens, cameras, microphones and keystrokes, so security and privacy issues matter a lot here. Thank you for reporting them responsibly.

## Reporting a vulnerability

Please **don't open a public issue**. Instead, use GitHub's private reporting on this repository: go to **Security → Report a vulnerability** and describe:

- what the problem is and what an attacker could do with it
- the steps or a proof of concept to reproduce it
- the macOS version and Take One version or commit you tested

You'll get an acknowledgement as soon as the maintainer sees it. Fixes are released as quickly as possible, and you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Only the latest code on `main` and the most recent release receive security fixes.

## Scope

Examples of what's in scope:

- Ways for a web page, project file, preset or share link to read, write or delete files, or run code
- Captured content (screen, camera, audio, keystrokes) leaking anywhere the user didn't choose, including passwords typed into secure fields
- Weaknesses in the self-hosted share server, such as access to private links without the key

Out of scope: problems that need an attacker who already controls your Mac or your user account, and issues in third-party dependencies that are already publicly known (please report those upstream).
