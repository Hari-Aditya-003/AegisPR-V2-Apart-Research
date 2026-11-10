# Security policy

The V2 preview supports maintainer-allowlisted public source review and fixed, committed demonstration fixtures. Arbitrary repository dependency installation, anonymous code execution, automatic repair push, and automatic merging are not enabled.

Report a suspected vulnerability privately through this repository's GitHub Security Advisories **Report a vulnerability** page when available. If private reporting is unavailable, contact the repository owner privately before sharing reproduction details. Do not publish real credentials, exploit payloads, private repository content, or unrelated user data in an issue.

The operator must keep provider keys, owner access codes, GitHub App private keys, webhook secrets, and receipt private keys outside source control. Receipt key loss invalidates continuity of signer identity; signature verification alone does not establish that a host or its outputs are trustworthy.

The fixture worker has Docker-socket authority on its operator host. It must not accept uploaded code, packages, build instructions, arbitrary images, mounts, URLs, or commands. Its signed output identifies the configured worker and request; it does not attest a hypervisor or prove the absence of a kernel escape.

The API and worker are intended to run as separate containers with separate credentials and data volumes. Guest test containers receive no provider credentials or socket. Network access is disabled in those guest containers, and their images are pre-pulled by digest. Build-time dependency resolution is excluded from this preview's public interface.

Review [the release scope and unfulfilled isolation gates](docs/v2-release.md) before exposing the service beyond a trusted private network.
