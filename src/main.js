import { mountApp } from "./components/App/App.js";
import { mountAuth } from "./components/Auth/Auth.js";
import { getCurrentUser } from "./services/authService.js";

const root = document.querySelector("#app");

document.documentElement.dataset.theme = "dark";

boot();

async function boot() {
  try {
    const session = await getCurrentUser();

    if (session.authenticated) {
      await mountPortfolio(session.user);
      return;
    }

    await showAuth();
  } catch (error) {
    showFatal(error);
  }
}

async function showAuth() {
  document.documentElement.dataset.theme = "dark";
  await mountAuth(root, {
    onAuthenticated: (user) => {
      mountPortfolio(user).catch(showFatal);
    },
  });
}

async function mountPortfolio(user) {
  await mountApp(root, {
    user,
    onLogout: () => {
      showAuth().catch(showFatal);
    },
  });
}

function showFatal(error) {
  console.error(error);
  root.textContent = "";
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const message = document.createElement("p");

  container.className = "fatal-state";
  container.dir = "rtl";
  title.textContent = "Portfolio Live failed to load";
  message.textContent = error?.message ?? "Unknown error";
  container.append(title, message);
  root.append(container);
}
