export function replaceHtml(targetEl, html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const newContent = template.content.firstElementChild;
  const scripts = newContent.querySelectorAll("script");
  injectScripts(scripts);
  diffAndPatch(targetEl.parentElement, targetEl, newContent);
}

export function injectScripts(scripts) {
  scripts.forEach((scriptElement) => {
    const script = document.createElement("script");
    script.type = scriptElement.type || "text/javascript";
    if (scriptElement.src) {
      script.src = scriptElement.src;
    } else {
      script.textContent = scriptElement.textContent;
    }
    document.head.appendChild(script);
    document.head.removeChild(script);
  });
}

export function diffAndPatch(parent, oldNode, newNode) {
  if (!oldNode || oldNode.nodeName !== newNode.nodeName) {
    if (
      oldNode &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      oldNode._x_dataStack &&
      window.Alpine
    ) {
      window.Alpine.destroyTree(oldNode);
    }
    oldNode
      ? parent.replaceChild(newNode, oldNode)
      : parent.appendChild(newNode);
    return;
  }

  if (
    oldNode.nodeType === Node.TEXT_NODE &&
    oldNode.textContent !== newNode.textContent
  ) {
    oldNode.textContent = newNode.textContent;
    return;
  }

  if (oldNode.nodeType === Node.ELEMENT_NODE) {
    if (oldNode.hasAttribute("x-ignore") || newNode.hasAttribute("x-ignore")) {
      return; // Skip diffing inside x-ignore subtrees
    }

    if (
      oldNode.hasAttribute("x-data") &&
      oldNode.getAttribute("x-data") !== newNode.getAttribute("x-data")
    ) {
      if (oldNode._x_dataStack && window.Alpine)
        window.Alpine.destroyTree(oldNode);
      parent.replaceChild(newNode, oldNode);
      return;
    }

    const oldAttributes = Array.from(oldNode.attributes);
    const newAttributes = Array.from(newNode.attributes);

    newAttributes.forEach((attr) => {
      if (oldNode.getAttribute(attr.name) !== attr.value) {
        oldNode.setAttribute(attr.name, attr.value);
      }
    });

    oldAttributes.forEach((attr) => {
      const isManagedByAlpine = oldAttributes.some((bindAttr) => {
        const match = bindAttr.name.match(/^(x-bind:|:)(.+)$/);
        return match && match[2] === attr.name;
      });
      if (
        !newNode.hasAttribute(attr.name) &&
        !isManagedByAlpine &&
        !(
          attr.name === "style" &&
          oldAttributes.some((a) => a.name === "x-show")
        )
      ) {
        oldNode.removeAttribute(attr.name);
      }
    });

    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(oldNode.tagName) &&
      !oldNode.hasAttribute("x-model")
    ) {
      if (
        oldNode.tagName === "INPUT" &&
        (oldNode.type === "checkbox" || oldNode.type === "radio")
      ) {
        if (oldNode.checked !== newNode.hasAttribute("checked")) {
          oldNode.checked = newNode.hasAttribute("checked");
        }
      } else if (oldNode.value !== newNode.value) {
        oldNode.value = newNode.value;
      }
    }

    if (
      oldAttributes.some((attr) => ["x-text", "x-html"].includes(attr.name))
    ) {
      return;
    }
  }

  const oldChildren = Array.from(oldNode.childNodes);
  const newChildren = Array.from(newNode.childNodes);

  const oldKeyed = new Map();
  oldChildren.forEach((child, i) => {
    if (child.nodeType === Node.ELEMENT_NODE && child.hasAttribute("key")) {
      oldKeyed.set(child.getAttribute("key"), child);
    }
  });

  let currentOldIndex = 0;

  newChildren.forEach((newChild, i) => {
    let matchingOldChild = null;

    if (
      newChild.nodeType === Node.ELEMENT_NODE &&
      newChild.hasAttribute("key")
    ) {
      const key = newChild.getAttribute("key");
      if (oldKeyed.has(key)) {
        matchingOldChild = oldKeyed.get(key);
        oldKeyed.delete(key);
      }
    } else if (currentOldIndex < oldChildren.length) {
      // Find next un-keyed old child
      while (currentOldIndex < oldChildren.length) {
        const oldC = oldChildren[currentOldIndex];
        if (
          !(oldC.nodeType === Node.ELEMENT_NODE && oldC.hasAttribute("key"))
        ) {
          matchingOldChild = oldC;
          break;
        }
        currentOldIndex++;
      }
    }

    if (matchingOldChild) {
      if (oldNode.childNodes[i] !== matchingOldChild) {
        oldNode.insertBefore(matchingOldChild, oldNode.childNodes[i] || null);
      }
      diffAndPatch(oldNode, matchingOldChild, newChild);
      if (matchingOldChild === oldChildren[currentOldIndex]) {
        currentOldIndex++;
      }
    } else {
      oldNode.insertBefore(newChild, oldNode.childNodes[i] || null);
    }
  });

  // Remove remaining old children
  const finalOldChildren = Array.from(oldNode.childNodes);
  for (let i = newChildren.length; i < finalOldChildren.length; i++) {
    const childToRemove = finalOldChildren[i];
    if (
      childToRemove.nodeType === Node.ELEMENT_NODE &&
      childToRemove._x_dataStack &&
      window.Alpine
    ) {
      window.Alpine.destroyTree(childToRemove);
    }
    oldNode.removeChild(childToRemove);
  }
}
