export function showUnexpectedResponseModal(statusCode, html) {
  const modalId = "fireline-unexpected-modal";

  const existing = document.getElementById(modalId);
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement("div");
  modal.id = modalId;
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.7); z-index: 999999;
    display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;
    font-family: system-ui, -apple-system, sans-serif;`;

  const header = document.createElement("div");
  header.style.cssText = `
    background: #f87171; color: white; padding: 15px 20px;
    border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;
    align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);`;

  const title = document.createElement("h2");
  title.style.cssText = "margin: 0; font-size: 1.25rem; font-weight: 600;";
  title.textContent = `Unexpected Response: ${statusCode}`;

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 10px;";

  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = "Reload";
  reloadBtn.style.cssText =
    "background: white; color: #dc2626; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 500;";
  reloadBtn.onclick = () => window.location.reload();

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Dismiss";
  closeBtn.style.cssText =
    "background: transparent; color: white; border: 1px solid white; padding: 6px 12px; border-radius: 4px; cursor: pointer;";
  closeBtn.onclick = () => modal.remove();

  actions.appendChild(reloadBtn);
  actions.appendChild(closeBtn);

  header.appendChild(title);
  header.appendChild(actions);

  const iframeWrapper = document.createElement("div");
  iframeWrapper.style.cssText = `
    flex-grow: 1; background: white; border-radius: 0 0 8px 8px;
    overflow: hidden; box-shadow: 0 10px 15px rgba(0,0,0,0.1);`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width: 100%; height: 100%; border: none;";
  iframe.setAttribute("sandbox", "");
  iframe.title = "FireLine unexpected server response";
  iframe.srcdoc = html || "<i>No HTML provided</i>";

  iframeWrapper.appendChild(iframe);
  modal.appendChild(header);
  modal.appendChild(iframeWrapper);

  document.body.appendChild(modal);
}

export function dismissUnexpectedResponseModal() {
  const existing = document.getElementById("fireline-unexpected-modal");
  if (existing) {
    existing.remove();
  }
}
