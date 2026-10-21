/** A short message at the bottom of the screen that goes away by itself. */
export function showToast(text: string, ms = 2500) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.appendChild(el);
  window.setTimeout(() => el.classList.add("leaving"), ms);
  window.setTimeout(() => el.remove(), ms + 300);
}
