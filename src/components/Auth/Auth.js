import { query, refreshIcons } from "../../lib/dom.js";
import { loadTemplate } from "../../lib/template.js";
import {
  confirmPasswordReset,
  loginUser,
  registerUser,
  requestPasswordReset,
} from "../../services/authService.js";

export async function mountAuth(root, { onAuthenticated } = {}) {
  const template = await loadTemplate(new URL("./Auth.html", import.meta.url));
  root.innerHTML = template;

  let mode = "login";
  let resetStage = "request";
  let resetEmail = "";
  const form = query(root, "[data-auth-form]");
  const error = query(root, "[data-auth-error]");
  const notice = query(root, "[data-auth-notice]");
  const submitLabel = query(root, "[data-submit-label]");
  const submitButton = query(root, "[data-auth-submit]");
  const passwordLabel = query(root, "[data-password-label]");
  const passwordField = query(root, "[data-password-field]");
  const passwordInput = query(root, '[name="password"]');
  const resetTokenField = query(root, "[data-reset-token-field]");
  const resetTokenInput = query(root, '[name="resetToken"]');
  const modeButtons = [...root.querySelectorAll("[data-mode]")];

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      resetStage = "request";
      resetEmail = "";
      syncMode();
    });
  });

  query(root, '[data-action="reset-password"]').addEventListener("click", () => {
    mode = "reset";
    resetStage = "request";
    syncMode();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    submitButton.disabled = true;

    try {
      const formData = new FormData(form);
      const credentials = {
        displayName: String(formData.get("displayName") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || ""),
        token: String(formData.get("resetToken") || "").trim(),
      };
      const result = await submitAuth(credentials);

      if (result?.authenticatedUser) {
        onAuthenticated?.(result.authenticatedUser);
      }
    } catch (authError) {
      setError(authError.message);
    } finally {
      submitButton.disabled = false;
    }
  });

  syncMode();
  hydrateResetTokenFromUrl();
  refreshIcons();

  function syncMode() {
    form.classList.toggle("is-register", mode === "register");
    form.classList.toggle("is-reset", mode === "reset");
    form.classList.toggle("is-reset-request", mode === "reset" && resetStage === "request");
    form.classList.toggle("is-reset-confirm", mode === "reset" && resetStage === "confirm");
    submitLabel.textContent = createSubmitLabel(mode, resetStage);
    passwordLabel.textContent = mode === "reset" ? "סיסמה חדשה" : "סיסמה";
    submitButton.querySelector("i")?.setAttribute("data-lucide", createSubmitIcon(mode));
    passwordInput.autocomplete =
      mode === "register" || mode === "reset" ? "new-password" : "current-password";
    passwordInput.required = mode !== "reset" || resetStage === "confirm";
    resetTokenInput.required = mode === "reset" && resetStage === "confirm";
    passwordField.hidden = mode === "reset" && resetStage === "request";
    resetTokenField.hidden = mode !== "reset" || resetStage !== "confirm";
    modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });
    setError("");
    setNotice("");
    refreshIcons();
  }

  function setError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function setNotice(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }

  async function submitAuth(credentials) {
    if (mode === "register") {
      return { authenticatedUser: await registerUser(credentials) };
    }

    if (mode === "reset") {
      if (resetStage === "request") {
        const result = await requestPasswordReset(credentials);
        resetEmail = credentials.email;
        resetStage = "confirm";
        syncMode();
        setNotice(result.message || "אם החשבון קיים, נשלח אליו קוד איפוס.");
        return null;
      }

      await confirmPasswordReset(credentials);
      mode = "login";
      resetStage = "request";
      form.reset();
      query(form, '[name="email"]').value = resetEmail;
      resetEmail = "";
      syncMode();
      setNotice("הסיסמה עודכנה. אפשר להתחבר עם הסיסמה החדשה.");
      return null;
    }

    return { authenticatedUser: await loginUser(credentials) };
  }

  function hydrateResetTokenFromUrl() {
    const token = new URLSearchParams(window.location.search).get("resetToken");

    if (!token) {
      return;
    }

    mode = "reset";
    resetStage = "confirm";
    resetTokenInput.value = token;
    syncMode();
  }
}

function createSubmitLabel(mode, resetStage = "request") {
  if (mode === "register") {
    return "יצירת חשבון";
  }

  if (mode === "reset") {
    return resetStage === "request" ? "שליחת קוד איפוס" : "עדכון סיסמה";
  }

  return "כניסה לחשבון";
}

function createSubmitIcon(mode) {
  if (mode === "register") {
    return "user-plus";
  }

  if (mode === "reset") {
    return "key-round";
  }

  return "log-in";
}
