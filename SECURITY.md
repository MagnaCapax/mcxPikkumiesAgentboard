# Security Policy

## Reporting Security Issues

If you believe you have found a security vulnerability in this fork, report it privately. **Do not report undisclosed vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please report them via:
- [Fork GitHub Security Advisory](https://github.com/MagnaCapax/mcxPikkumiesAgentboard/security/advisories/new)

### Reporting Process
1. **Submit Report**: Use the above channel to submit your report
2. **Response Time**: We will acknowledge receipt of your report within 14 business days
3. **Collaboration**: We will collaborate with you to understand and validate the issue
4. **Resolution**: We will work on a fix and coordinate the release process

### Disclosure Policy
- Please provide detailed reports with reproducible steps
- Include the version/commit hash where you discovered the vulnerability
- Allow us a 90-day security fix window before any public disclosure
- After a patch is released, allow 30 days for users to update before public disclosure (for a total of 120 days max)
- Share any potential mitigations or workarounds if known

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest fork release | Yes |
| Latest commit on the default branch | Yes |
| All other versions | No |


## Security Considerations

This fork provides a web-based interface to tmux terminal sessions. By design, a valid bearer grants terminal access as the account user. Run it only behind the account launcher and reverse proxy described in the README. The process refuses production TCP listeners.

---
Last updated: October 2026
