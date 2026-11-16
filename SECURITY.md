# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities through GitHub's
[private vulnerability reporting](https://github.com/maugenst/zip-a-folder/security/advisories/new)
rather than public issues, pull requests, or discussions.

To enable the "Report a vulnerability" button, private vulnerability reporting
must be turned on under **Settings → Security → Private vulnerability reporting**.

We aim to acknowledge reports within a few days and will coordinate disclosure
with the reporter. Reporters are credited in the published advisory unless they
ask to remain anonymous.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 7.x     | :white_check_mark: |
| < 7.0   | :x:                |

## Past Advisories

- Path traversal in glob mode (affects `>=3.0.0 <7.0.1`, fixed in **7.0.1**).
  Reported by [@DragonPwn](https://github.com/DragonPwn) via coordinated disclosure.
