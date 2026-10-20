const MODAL_ID = "fireline-unexpected-modal";

function onEscape(e) {
  if (e.key === "Escape") dismissUnexpectedResponseModal();
}

export function showUnexpectedResponseModal(statusCode, html) {
  // Don't open a modal inside the modal's own iframe
  if (window.self !== window.top) return;

  dismissUnexpectedResponseModal();

  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    padding: 40px; box-sizing: border-box;
    background: rgba(0, 0, 0, 0.7);`;

  // Clicking the dark backdrop closes the modal
  modal.addEventListener("click", (e) => {
    if (e.target === modal) dismissUnexpectedResponseModal();
  });

  const iframe = document.createElement("iframe");
  iframe.title = `FireLine unexpected response (${statusCode})`;
  iframe.style.cssText = `
    width: 100%; height: 100%; border: none;
    background: white; border-radius: 8px;`;

  // Sandbox the iframe to prevent it from executing scripts or accessing the parent page
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");

  iframe.srcdoc = html || "<i>No HTML provided</i>";

  modal.appendChild(iframe);
  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onEscape);
}

export function dismissUnexpectedResponseModal() {
  const modal = document.getElementById(MODAL_ID);
  modal && modal.remove();

  document.body.style.overflow = "";
  document.removeEventListener("keydown", onEscape);
}
