# pdfgen-database-server

Express + `better-sqlite3` backend for PDF-gen (`07-pdfgen-dbnormal`, forked
from `05-pdfgen-database`'s server — see `CLAUDE.md` at the repo root for the
full project history).

## Setup

```
npm install
npm start
```

### `npm install` fails on `better-sqlite3` (corporate network / proxy)

On this network (behind the LMCO proxy), a plain `npm install` will fail
partway through with something like:

```
npm ERR! path ...\server\node_modules\better-sqlite3
npm ERR! command failed
npm ERR! command ...cmd.exe /d /s /c prebuild-install || node-gyp rebuild --release
...
npm ERR! gyp ERR! stack FetchError: request to
https://nodejs.org/download/release/v18.17.1/node-v18.17.1-headers.tar.gz
failed, reason: read ECONNRESET
```

**Root cause:** `better-sqlite3` is a native module. Its install step runs
`prebuild-install` (fetches a precompiled binary from GitHub releases) and,
if that fails, falls back to `node-gyp rebuild` (fetches the Node.js headers
straight from `nodejs.org`). Both of these are separate child processes that
only honor the `HTTPS_PROXY` / `HTTP_PROXY` **environment variables** — they
do *not* read npm's own `.npmrc` `proxy` / `https-proxy` settings. Plain
`npm install` for pure-JS deps (express, etc.) works fine because npm itself
does read `.npmrc` and routes those through the Nexus registry mirror; the
direct-to-`nodejs.org`/GitHub calls bypass that proxy config entirely and get
reset by the firewall.

**Fix** — export the proxy (and CA cert) as real environment variables
before installing, so the child processes inherit them too:

PowerShell:
```powershell
$env:HTTPS_PROXY = "http://proxy-zsgov.external.lmco.com:80/"
$env:HTTP_PROXY  = "http://proxy-zsgov.external.lmco.com:80/"
$env:NODE_EXTRA_CA_CERTS = "C:\Utilities\Combined_pem.pem"
npm install
```

bash:
```bash
export HTTPS_PROXY="http://proxy-zsgov.external.lmco.com:80/"
export HTTP_PROXY="http://proxy-zsgov.external.lmco.com:80/"
export NODE_EXTRA_CA_CERTS="C:\Utilities\Combined_pem.pem"
npm install
```

Make it permanent by setting these as persistent Windows user environment
variables (System Properties → Environment Variables) or adding the
`$env:...` lines to your PowerShell profile, instead of exporting them by
hand every time.
