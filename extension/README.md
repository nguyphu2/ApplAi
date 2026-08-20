# ApplAI Autofill

Chrome extension (Manifest V3) that fills job application form fields from your saved ApplAI
profile. It runs in two passes: a local synonym-dictionary matcher fills what it can with no
network call at all, then whatever's still unmatched gets sent to the `applai-autofill` Lambda
(field labels, names, placeholders, and the page title only — no full page content), which asks
Claude to resolve what it can from your saved profile and resume text. If the `/autofill` Lambda
and route aren't deployed, or the request fails for any reason, the extension falls back to
showing only the local pass's results with a "couldn't reach ApplAI for the rest" message — the
local fill is never lost or blocked on the remote pass.

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode (top right).
3. Click "Load unpacked" and select the `extension/` directory.

## Register the Cognito redirect URI (one-time, per person/machine)

The redirect URI Chrome generates for an unpacked extension is derived from its install path, so
this only needs to be done once per person/machine, and again if the extension is reloaded from a
different path.

1. After loading the extension, open its service worker console: on the extension's card at
   `chrome://extensions`, click the "service worker" link.
2. In that console, run:
   ```js
   chrome.identity.getRedirectURL()
   ```
3. Register the returned URI with the Cognito app client:
   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id us-east-1_s3veOH9Yc \
     --client-id 5fub35eljp359gg26pdckauqvr \
     --client-name applai-web \
     --refresh-token-validity 30 \
     --supported-identity-providers COGNITO \
     --callback-urls "http://localhost:8000/" "https://d1f2dokthsqqjc.cloudfront.net/" "PASTE_EXTENSION_REDIRECT_URI_HERE" \
     --logout-urls "http://localhost:8000/" "https://d1f2dokthsqqjc.cloudfront.net/" \
     --allowed-o-auth-flows code \
     --allowed-o-auth-scopes email openid \
     --allowed-o-auth-flows-user-pool-client \
     --auth-session-validity 3
   ```

## Testing against the sample form

`extension/test-fixtures/sample-form.html` is a local `file://` page. `activeTab` does not grant
access to `file://` URLs on its own, so enable "Allow access to file URLs" for this extension at
`chrome://extensions` (off by default) before testing against it.

## Running the matcher's unit tests

Requires Node.js 18+.

```bash
node --test extension/test/matcher.test.js
```
