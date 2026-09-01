# Security

[Русский](SECURITY.md) · [English](SECURITY.en.md)

## Reporting a vulnerability

Do not disclose vulnerabilities in a regular Issue. Use **Security → Report a vulnerability** when private reporting is available for the repository. Otherwise, contact the repository owner through a previously agreed private channel.

Include the following information:

- the affected version;
- prerequisites and exact reproduction steps;
- expected and actual behavior;
- potential impact on user data;
- a safe example containing no real secrets.

Never attach real passwords, recovery keys, or personal vault contents. Receipt will be acknowledged within seven days. Remediation time depends on severity and implementation complexity.

## Supported versions

Security updates are provided for the latest Windows release. Download installers only from this repository's Releases page and verify the published SHA-256 checksum.

## Scope of assurance

The project uses standard cryptographic primitives, but it has not yet undergone an independent external audit. Security also depends on the Windows environment, device protection, and the safety of the master password.
