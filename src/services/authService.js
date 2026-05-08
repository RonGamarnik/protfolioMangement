const AUTH_TOKEN_KEY = "portfolio-live-auth-token";

let sessionToken = sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);
let currentUser = null;

if (localStorage.getItem(AUTH_TOKEN_KEY)) {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  if (sessionToken) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, sessionToken);
  }
}

export function getAuthHeader() {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}

export function getSignedInUser() {
  return currentUser;
}

export async function getCurrentUser() {
  if (!sessionToken) {
    currentUser = null;
    return { authenticated: false, user: null };
  }

  const response = await fetch("/api/auth/me", {
    cache: "no-store",
    headers: getAuthHeader(),
  });

  if (!response.ok) {
    sessionToken = null;
    currentUser = null;
    clearStoredToken();
    return { authenticated: false, user: null };
  }

  const payload = await response.json();
  currentUser = payload.authenticated ? payload.user : null;
  return payload;
}

export async function loginUser(credentials) {
  return authenticate("/api/auth/login", credentials);
}

export async function registerUser(credentials) {
  return authenticate("/api/auth/register", credentials);
}

export async function requestPasswordReset({ email }) {
  return postJson("/api/auth/request-password-reset", { email });
}

export async function confirmPasswordReset({ email, token, password }) {
  return postJson("/api/auth/confirm-password-reset", { email, token, password });
}

export async function logoutUser() {
  if (sessionToken) {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: getAuthHeader(),
    }).catch(() => {});
  }

  sessionToken = null;
  currentUser = null;
  clearStoredToken();
}

async function authenticate(endpoint, credentials) {
  const payload = await postJson(endpoint, credentials);

  sessionToken = payload.token;
  currentUser = payload.user;
  storeToken(sessionToken);
  return payload.user;
}

async function postJson(endpoint, credentials) {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "הפעולה נכשלה");
  }

  return payload;
}

function storeToken(token) {
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearStoredToken() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
