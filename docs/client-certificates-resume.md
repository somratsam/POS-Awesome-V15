# Client certificates (approved store devices) — resume note

Status (2026-11-25): **paused until January 2027** (user's vacation). Staging test
setup built and left running in log-only mode. Nothing on production, nothing in
the POS Awesome code. PROGRESS_NOTES section 122.

Proposal page (v3): https://claude.ai/artifact/32mbBWjFdZdpUmgDCnydQq
(local copy: `~/staging-mtls-test/proposal/approved-store-devices-v3.html`)

## Decisions already made
- Protect the **whole site** (POS, Desk /app, /api, socket.io, login page), for all accounts.
- The **rewards portal stays public** (its own nginx server block, no certificate check).
- **Optional per client**: server (nginx) configuration only, not code in the fork.
  A client who doesn't want it simply doesn't get the files.
- **Three on/off levels:**
  1. log-only / enforce switch: `lock-logonly.sh` / `lock-enforce.sh`;
  2. fully off by commenting out the include line: `lock-off.sh` / `lock-on.sh`;
  3. block one device by serial: `revoke.sh` / `unrevoke.sh`.
- **Log-only first** on production, read the logs, then enforce.
- **Production gets its own CA**, made on the production server. The staging test CA
  ("Swan STAGING TEST Devices CA") must never be used for production.
- Device certificates are **valid for 2–3 years, with renewal reminders**
  (`days_left` is in the log; `devices-report.sh`).
- Revocation uses a serial-list map, not a CRL: an expired CRL locks out every device (tested).
- **2FA for admin roles is not enabled yet**; the user will do it later. Note that
  2FA never applies to "Administrator" and is skipped by email-link login.

## Fix made to the "fully off" switch (level 2)
In the first design, `set $store_enforce` lived inside the included snippet. Commenting
out the include then made `nginx -t` fail with `unknown "store_enforce" variable`.
- The script's safety net restored the file, so nothing broke.
- Fix: the switch is now an http-level `map $server_name $store_enforce { default 0; }`
  in `00-store-devices.conf`, and the `set` is gone.
- The scripts' sed and the proposal (v3) were updated to match.

## Where the test setup lives (staging only)
- `~/staging-mtls-test/`:
  - `nginx-bin/nginx`: nginx 1.24 from the Ubuntu package, run as `aziz`, no sudo.
  - `conf/`: `nginx.conf`, `00-store-devices.conf`, `store-ca/server.conf`,
    `revoked-serials.map`, and the "not approved" page.
  - `client-ca/`: the test devices CA plus the TEST-PC1 and TEST-PC1-EXPIRED certificates.
  - `server-ca/`: the HTTPS certificate for staging.local and rewards.staging.local.
    It is name-constrained, and its CA key is destroyed.
  - `scripts/`: run them as `cd ~/staging-mtls-test/scripts && ./lock-status.sh`.
    For another server, copy `lock.env.production-example` and run with
    `LOCK_ENV=./lock.env.<name>`.
  - `for-windows/`: on Windows this is
    `\\wsl.localhost\Ubuntu-24.04\home\aziz\staging-mtls-test\for-windows`.
    The .pfx password is `TestPC1-staging`.
  - `logs/store-devices.log`: the user's runs. `store-devices.log.claude-tests` holds my curl runs.
- Addresses:
  - POS: `https://staging.local:8443/app/posapp`
  - rewards stand-in: `https://rewards.staging.local:8443`
  - normal staging `http://staging.local:8000` is unchanged.
- TEST-PC1 serial: `2087EEBBD3B42EE0CD07F72DCB0F63E81DB01445` (valid to 26 Feb 2029).
- TEST-PC1-EXPIRED serial: `5868D427F44E932D1F2562DDF561C9FE2F91F23A`.
- The staging HTTPS certificate is valid to 25 Dec 2027.
- **After a WSL restart or reboot** the test nginx is not running.
  Start it with `~/staging-mtls-test/scripts/start-test-nginx.sh` before testing.
  Nothing else needs redoing.
- **Remove everything:** `~/staging-mtls-test/scripts/stop-test-nginx.sh && rm -rf ~/staging-mtls-test`.
  On Windows:
  - delete the TEST-PC1* certificates (certmgr, Personal);
  - delete "Swan STAGING TEST Server CA" (Trusted Root);
  - run `chrome-store-cert-STAGING-REMOVE.reg`;
  - delete the desktop .cmd and `C:\temp\certtest`.

## Staging-only workarounds (not for production)
- Windows requests reach nginx as 127.0.0.1, so the trusted-source `geo` list is empty.
  The production server-IP exemption is shown only by curl.
- Staging runs `bench serve`, which sets `window.dev_server = 1`.
  - The test nginx rewrites it to 0 (`sub_filter`).
  - It also sends socket.io's session check straight to :8000 (Origin override).
- Don't test Desk PDFs (wkhtmltopdf) through 8443: they would hit the lock from 127.0.0.1.

## The 13-step Windows checklist (run in order)
1. **Trust the test server.** Import `STAGING-TEST-Server-CA.crt`: Current User → Trusted Root.
   → Chrome opens the POS address with a padlock.
2. **Log-only, no certificate.** → The POS works and rewards opens.
3. **Option A.** Import `TEST-PC1.pfx`: Current User, password, "exportable" unticked.
   → certmgr.msc, Personal shows TEST-PC1.
4. **Before the Chrome policy.** Restart Chrome and open the POS.
   → Chrome asks to pick a certificate. Note whether it asks again after a full restart.
5. **Chrome policy.** Run `chrome-store-cert-STAGING.reg`, restart Chrome, open `chrome://policy`.
   → AutoSelectCertificateForUrls is listed, and no certificate question appears.
6. **App-mode shortcut** (`POS-STAGING-HTTPS.cmd`), started 3 times.
   → Note whether a certificate question appears on any start (expected: none).
7. **POS checks.**
   - `chrome://serviceworker-internals` → ACTIVATED.
   - ToDo list live update in two windows.
   - QZ Tray receipt and Z Report (allow the new origin once).
   - Offline: `stop-test-nginx.sh`, make a sale, `start-test-nginx.sh`, check the invoice synced.
8. **Enforce.** Run `./lock-enforce.sh`.
   - Chrome with the certificate works.
   - Edge with Cancel → "This computer is not approved".
   - Rewards still opens in Edge.
9. **Revoke.** Run `./revoke.sh <TEST-PC1 serial> "TEST-PC1 test"` → the not-approved page.
   Run `./unrevoke.sh <serial>` → the POS works again.
10. **Back to log-only.** Run `./lock-logonly.sh` → Edge with Cancel reaches the login page.
11. **Expired certificate.** Swap TEST-PC1 for `TEST-PC1-EXPIRED.pfx`, restart Chrome.
    → Report (a) "not approved" (Chrome sent it; nginx answers 400) or (b) the POS opens
    (Chrome held it back). Then swap back.
12. **Switch-off levels.**
    - `./lock-enforce.sh`, then `./lock-off.sh` → Edge opens the POS.
    - `./lock-on.sh` → Edge is blocked.
    - `./lock-logonly.sh` to finish.
13. **Option B (TPM).**
    - `tpm.msc` shows ready, version 2.0.
    - `certreq -new request-TEST-PC1-TPM.inf TEST-PC1-TPM.csr`, then `./sign-csr.sh <csr>`,
      then `certreq -accept TEST-PC1-TPM.crt`.
    - → The export option for the private key is greyed out, and `devices-report.sh` shows CN=TEST-PC1-TPM.
    - Fallback: `request-TEST-PC1-SOFTWARE.inf`.

**Results the user owes me:** steps **4, 6, 7 and 11** in particular, plus anything that
didn't match the expected result.

## What is tested and what is still untested
- **Tested (curl and headless Chrome, 2026-11-24):**
  - log-only: no certificate 200, valid 200, expired 400;
  - enforce: no certificate 403 plus the page, valid 200, expired 400;
  - revoke and unrevoke;
  - level-2 off and on;
  - the rewards block is open in every mode;
  - Windows reaches 8443;
  - the POS loads signed in;
  - socket.io connects through nginx with the certificate;
  - `sw.js` is fetched with the certificate.
- **Still untested (needs the user's Windows PC):**
  - the Windows import (Options A and B);
  - the Chrome policy;
  - the app-mode prompts;
  - service-worker registration (Playwright's certificate proxy breaks it in my harness);
  - an offline sale;
  - QZ Tray printing;
  - the expired certificate in real Chrome;
  - Edge without a certificate.

## Production (later, the user runs every command)
Follow the proposal v3 steps. Its checklist includes "open the rewards portal from a
phone with no certificate": it must stay open in both modes.
