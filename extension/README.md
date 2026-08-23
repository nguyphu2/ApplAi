# ApplAI Resume Optimizer

Chrome extension (Manifest V3) that rewrites a saved DOCX resume's bullet points and summary
toward a target keyword-match percentage against the job description on the current page. Editing
happens in place inside the original DOCX file's paragraph runs, so every font, margin, and layout
choice from the original document survives untouched.

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

## Using it

1. Upload a DOCX resume on the ApplAI website's Profile tab.
2. Navigate to a job description page (a posting's own page - not the application form).
3. Open the extension popup, pick the resume, set a target match percentage and the two toggles,
   and click Optimize.
