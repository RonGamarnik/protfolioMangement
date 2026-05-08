import { loadTemplate, renderTemplate } from "../../lib/template.js";

export async function createToast(container) {
  const template = await loadTemplate(new URL("./Toast.html", import.meta.url));

  return {
    show(message, type = "info") {
      const element = document.createElement("div");
      element.innerHTML = renderTemplate(template, {
        message,
        type,
      });

      const toast = element.firstElementChild;
      container.append(toast);

      window.setTimeout(() => {
        toast.remove();
      }, 4200);
    },
  };
}
