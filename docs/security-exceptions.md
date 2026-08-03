# Security Exceptions Register — Database Component

**Scope:** HIGH-severity CVEs reported by `npm run security:scan:component:database` against the
image built from `Dockerfile.postgres`.
**Assessed:** 2026-08-03
**Recheck due:** 2026-11-01 (90 days)
**Owner:** Repository owner

Every accepted item below is **time-boxed**. On the recheck date, re-run the scan and either close
the entry (an upstream fix landed) or re-accept it with a fresh 90-day window and a restated
rationale. An exception with no expiry is not an exception, it is a silent decision.

## Why these are accepted rather than fixed

All 23 HIGH findings sit at `path: base-image` — they are OS packages and vendored binaries inside
the upstream PostgreSQL container. **None are in this repository's code, SQL, or schema.**

Two remediation routes were attempted on 2026-08-03 and both are exhausted:

1. **Bump the base image.** `postgres:16` already resolves to `16.14`, which is exactly what
   `Dockerfile.postgres` pins. There is no newer release on the 16.x line to move to.
2. **Rebuild without cache.** `Dockerfile.postgres` already runs `apt-get -y upgrade`, so a
   `--no-cache` rebuild re-runs it against current Debian. Counts before and after were
   **identical** (HIGH 23 / MODERATE 47 / LOW 49 / UNKNOWN 5). Debian has published no fixes for
   the affected packages.

That leaves only a PostgreSQL 17 major-version move, which is a migration exercise with its own
risk and is out of proportion to base-image CVEs in a container with no direct inbound exposure.

### The 14 `stdlib` entries need care when reading

Trivy reports a `fixedVersion` for all 14 (Go 1.25.x / 1.26.x). **That is misleading in this
context** — these are the Go standard library compiled into a vendored binary, not an apt package.
They cannot be upgraded with a package manager; upstream must rebuild the image against a newer
Go toolchain. Treat "has a fix" here as "upstream could fix it", not "we can".

Open question, recorded honestly: a scan of `postgres:16.14` for Go build IDs found **no Go binary**
in the base layers. The finding is attributed to the built image. Worth resolving at recheck — if
the binary can be identified and is unused, removing it clears 14 of 23 outright.

## Exposure assessment

- The PostgreSQL container publishes **only** port 5432, and only to the compose network plus
  localhost in dev. It is not internet-facing.
- The affected packages (`libperl5.40`, `dirmngr`, `gzip`, `bsdutils`, `libacl1`, `libncursesw6`)
  are base OS tooling. None sit on the request path of the reconciliation application.
- Exploiting most of these requires either local execution inside the container or the ability to
  feed crafted input to a tool the application never invokes.
- As of changesets 0029/0030 the application connects under a least-privilege role with row-level
  security enforced, so container-local compromise no longer implies unrestricted data access.

This is a materially different risk class from an application vulnerability, and should be
presented that way in technical due diligence — with the caveat that "not currently exploitable"
is not "not a finding", and the recheck date is what keeps that claim honest.

## Accepted findings — all expire 2026-11-01

| CVE            | Package      | Installed           | Upstream fix                 | Summary                                                      |
| -------------- | ------------ | ------------------- | ---------------------------- | ------------------------------------------------------------ |
| CVE-2026-53615 | bsdutils     | 1:2.41-5            | —                            | [Integer Overflow or Wraparound in libblkid/src/partitions/d |
| CVE-2026-24882 | dirmngr      | 2.4.7-21+deb13u1+b4 | —                            | GnuPG: GnuPG: Stack-based buffer overflow in tpm2daemon allo |
| CVE-2026-41992 | gzip         | 1.13-1              | —                            | GNU gzip contains a global buffer overflow vulnerability in  |
| CVE-2026-54369 | libacl1      | 2.3.2-2+b1          | —                            | acl: Symlink traversal privilege escalation via libacl funct |
| CVE-2025-69720 | libncursesw6 | 6.5+20250216-2      | —                            | ncurses: ncurses: Buffer overflow vulnerability may lead to  |
| CVE-2026-42497 | libperl5.40  | 5.40.1-6            | —                            | perl-Archive-Tar: perl-Archive-Tar: Arbitrary file modificat |
| CVE-2026-48962 | libperl5.40  | 5.40.1-6            | —                            | perl-IO-Compress: perl-IO-Compress: Arbitrary code execution |
| CVE-2026-57432 | libperl5.40  | 5.40.1-6            | —                            | Perl versions through 5.43.10 have an integer overflow in S_ |
| CVE-2026-9538  | libperl5.40  | 5.40.1-6            | —                            | perl-Archive-Tar: perl-Archive-Tar: Denial of Service via cr |
| CVE-2025-61726 | stdlib       | v1.24.6             | 1.24.12, 1.25.6              | golang: net/url: Memory exhaustion in query parameter parsin |
| CVE-2025-61729 | stdlib       | v1.24.6             | 1.24.11, 1.25.5              | crypto/x509: golang: Denial of Service due to excessive reso |
| CVE-2026-25679 | stdlib       | v1.24.6             | 1.25.8, 1.26.1               | net/url: Incorrect parsing of IPv6 host literals in net/url  |
| CVE-2026-27145 | stdlib       | v1.24.6             | 1.25.11, 1.26.4              | crypto/x509: golang: golang crypto/x509: Denial of Service v |
| CVE-2026-32280 | stdlib       | v1.24.6             | 1.25.9, 1.26.2               | crypto/x509: crypto/tls: golang: Go: Denial of Service vulne |
| CVE-2026-32281 | stdlib       | v1.24.6             | 1.25.9, 1.26.2               | crypto/x509: golang: Go crypto/x509: Denial of Service via i |
| CVE-2026-32283 | stdlib       | v1.24.6             | 1.25.9, 1.26.2               | crypto/tls: golang: Go crypto/tls: Denial of Service via mul |
| CVE-2026-33811 | stdlib       | v1.24.6             | 1.25.10, 1.26.3              | net: golang: Go net package: Denial of Service via long CNAM |
| CVE-2026-33814 | stdlib       | v1.24.6             | 1.25.10, 1.26.3              | net/http/internal/http2: golang: golang.org/x/net: Go HTTP/2 |
| CVE-2026-39820 | stdlib       | v1.24.6             | 1.25.10, 1.26.3              | net/mail: golang: Go net/mail: Denial of Service via crafted |
| CVE-2026-39822 | stdlib       | v1.24.6             | 1.25.12, 1.26.5, 1.27.0-rc.2 | os: golang: Go os.Root: Symlink following vulnerability allo |
| CVE-2026-39836 | stdlib       | v1.24.6             | 1.25.10, 1.26.3              | net: golang: Go net package: Denial of Service via NUL byte  |
| CVE-2026-42499 | stdlib       | v1.24.6             | 1.25.10, 1.26.3              | net/mail: golang: net/mail: Denial of Service via pathologic |
| CVE-2026-42504 | stdlib       | v1.24.6             | 1.25.11, 1.26.4              | mime: golang: Golang MIME: Denial of Service via maliciously |

## Recheck procedure (due 2026-11-01)

```bash
docker pull postgres:16
npm run security:scan:component:database
```

For each entry above: if the CVE no longer appears, delete the row. If it still appears, confirm
whether an upstream fix has since shipped — if so, bump the base image and rebuild `--no-cache`
rather than re-accepting. Only re-accept what genuinely still has no route to remediation, and
reset the window to 90 days from that assessment.

## Known limitation

The scan runs with `policy.failOnCriticalOrHigh: true`, and **this register is documentation only —
the scanner does not read it.** The database component scan therefore still fails on these 23
findings. Wiring an allowlist (keyed by CVE id with an expiry date, so an expired entry fails the
build again) into `scripts/security-component-scan.mjs` is the follow-up that makes this register
operational rather than advisory.
