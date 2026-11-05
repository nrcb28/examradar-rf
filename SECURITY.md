# Security policy

This project is an experimental simulator. Security fixes target the current default branch and the supported Node.js versions listed in CI. There are no supported native mobile releases.

For a suspected vulnerability, use this repository's **Security → Report a vulnerability** option if private reporting is available. Otherwise request a private contact route from the maintainer before disclosing sensitive exploit details. Include the affected commit, environment, a minimal reproduction and the expected impact. Do not include real students' device identifiers or personal information in public issues.

Please run reproductions against your own local checkout. Do not scan classrooms or third-party services as part of a report.

The local server has no authentication or TLS and binds to loopback by default. The browser processes report files locally. Exported identifiers and exam metadata may be sensitive; device pseudonyms reduce disclosure but do not anonymize exam, classroom or instructor metadata. SHA-256 checksums do not authenticate reports or establish a chain of custody.
