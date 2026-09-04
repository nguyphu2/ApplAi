const CLIENT_ID = '5fub35eljp359gg26pdckauqvr';
const COGNITO_DOMAIN = 'https://applai-nguyphu2.auth.us-east-1.amazoncognito.com';
const REDIRECT_URI = window.location.origin + window.location.pathname;

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

export async function login() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // PKCE verifier only needs to survive the redirect round-trip within this
  // tab, so sessionStorage is correct here even though the tokens below use
  // localStorage to survive tab/browser closes.
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.href = `${COGNITO_DOMAIN}/login?${params.toString()}`;
}

export function clearTokens() {
  localStorage.removeItem('id_token');
  localStorage.removeItem('access_token');
}

export function logout() {
  clearTokens();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: REDIRECT_URI,
  });
  window.location.href = `${COGNITO_DOMAIN}/logout?${params.toString()}`;
}

export async function handleCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) {
    return false;
  }

  const verifier = sessionStorage.getItem('pkce_verifier');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  window.history.replaceState({}, document.title, REDIRECT_URI);

  if (!response.ok) {
    return false;
  }

  const tokens = await response.json();
  localStorage.setItem('id_token', tokens.id_token);
  localStorage.setItem('access_token', tokens.access_token);
  return true;
}

export function getIdToken() {
  return localStorage.getItem('id_token');
}

export function isLoggedIn() {
  return getIdToken() !== null;
}
