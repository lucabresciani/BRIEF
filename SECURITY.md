# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

Fixes are made on the latest release line only.

## What the application does with your files

BRIEF runs entirely in the browser. There is no server, no account and no upload: files are read
and processed on the device, and projects are stored in the browser's IndexedDB.

It does parse untrusted input locally:

- pasted text and CSV, TSV and TXT files;
- XLSX, XLS (Excel 97-2003 and 5.0/95) and ODS workbooks, read with SheetJS, normally in a Web
  Worker;
- `.sciplot` project files, validated against a schema before they are opened.

The production build sets a Content Security Policy (scripts only from the app's own origin, no
`eval`), refuses files above fixed size limits before reading them, and guards exported CSV cells
against formula injection.

Examples of problems worth reporting:

- a crafted file or paste that runs script, injects markup or escapes the Content Security Policy;
- a crafted project file that pollutes prototypes or corrupts other stored projects;
- a crafted file within the size limits that freezes or crashes the tab;
- an exported CSV, SVG or PNG that carries active content from an imported file;
- data leaving the device in any way.

Vulnerabilities in a dependency are welcome too, but please also report them to the project
concerned. Hosting headers are the responsibility of whoever deploys the static build.

## Reporting a vulnerability

Please report privately, through GitHub's
[private vulnerability reporting](https://github.com/lucabresciani/BRIEF/security/advisories/new)
(the **Report a vulnerability** button on the repository's **Security** tab). Do not open a public
issue, pull request or discussion for a security problem.

A useful report includes:

- the version or commit, the browser and the operating system;
- the steps to reproduce, and the smallest file that triggers the problem (with no personal data);
- what an attacker could achieve.

You should receive a first answer within about a week. Once the problem is confirmed, a fix is
prepared in a private advisory, released, and then published together with the advisory, crediting
you unless you prefer otherwise.
