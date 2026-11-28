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

## Encryption Notes

The `password` option on `sevenZip()` and `zip()` encrypts archive **data** with
AES-256 — the 7z `7zAES` coder (AES-256-CBC, key derived with 7-Zip's SHA-256 KDF,
2^19 iterations) for 7z, and WinZip AES-256 / AE-2 (PBKDF2-HMAC-SHA1 over 1000
iterations, AES-256-CTR, HMAC-SHA1 authentication) for ZIP. `tar()` has no
`password` option because the tar/gzip/brotli formats define no encryption.
Please note:

- **Filenames, sizes, timestamps and the directory structure are NOT encrypted.**
  Only file *contents* are protected. For 7z this matches `7z a -p<password>`
  without `-mhe` (encrypted headers are not supported). Do not rely on it to
  hide which files an archive contains.
- Encryption strength is bounded by the password — use a strong, high-entropy
  one. The 7z path uses a per-archive random IV (no extra salt, mirroring
  7-Zip's default output); the ZIP path uses a per-entry random PBKDF2 salt.
- **The WinZip AES format mandates only 1000 PBKDF2-HMAC-SHA1 iterations**, which
  is low by modern standards and cannot be increased without breaking
  interoperability with other ZIP tools. A long, random password is therefore
  especially important for encrypted ZIPs.
- Archives are interoperable with 7-Zip / p7zip (7z and ZIP) and WinZip (ZIP),
  which prompt for and verify the password on extraction. Very old `unzip`
  builds predating ZIP method 99 cannot read AES-encrypted ZIPs.
- On macOS, decrypt an AES ZIP with the native `bsdtar`
  (`bsdtar -xf archive.zip --passphrase <pw>`); the bundled `unzip`, `ditto`,
  and Finder's Archive Utility predate method 99 and cannot.
- `zip()` also offers `encryptionMethod: 'zipcrypto'` (legacy PKWARE encryption)
  **strictly for compatibility** with those old readers. ZipCrypto is
  **cryptographically broken** — a practical known-plaintext attack recovers the
  keystream — so it must not be treated as real protection. It is never the
  default, and `sevenZip()` has no such option.
