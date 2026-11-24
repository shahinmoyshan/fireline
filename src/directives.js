/** Register the fire:* attributes with Alpine. */
export function registerComponentDirectives(Alpine) {
  Alpine.mapAttributes(({ name, value }) => ({
    name: name.startsWith("fire:") ? `x-${name}` : name,
    value,
  }));

  Alpine.directive(
    "fire",
    (el, { value, modifiers, expression }, { evaluate, effect, cleanup }) => {
      const getComponent = () => {
        const root = el.closest("[data-fire-id]");
        return root ? Alpine.$data(root) : null;
      };

      switch (value) {
        case "model":
          handleModel(el, expression, modifiers, getComponent, effect, cleanup);
          break;
        case "click":
        case "submit": {
          const handler = (event) => {
            if (value === "submit" || modifiers.includes("prevent"))
              event.preventDefault();
            if (modifiers.includes("stop")) event.stopPropagation();
            const component = getComponent();
            if (component) runAction(component, expression, evaluate, event);
          };
          el.addEventListener(value, handler);
          cleanup(() => el.removeEventListener(value, handler));
          break;
        }
        case "loading":
          handleLoading(
            el,
            expression,
            modifiers,
            getComponent,
            effect,
            cleanup,
          );
          break;
        case "poll":
          handlePoll(
            el,
            expression,
            modifiers,
            getComponent,
            evaluate,
            cleanup,
          );
          break;
      }
    },
  );
}

function parseDuration(modifiers, fallback) {
  for (const modifier of modifiers) {
    const match = modifier.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
    if (!match) continue;
    const duration = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
    if (duration <= 2147483647) return duration;
  }
  return fallback;
}

function runAction(component, expression, evaluate, event) {
  const action = (expression || "").trim();
  if (!action) return;
  const match = action.match(/^([a-zA-Z_$][\w$]*)\s*(?:\(([\s\S]*)\))?$/);
  if (match) {
    const params = match[2]
      ? evaluate(`[${match[2]}]`, { scope: { $event: event } })
      : [];
    return component.call(match[1], ...params);
  }
  return evaluate(action, { scope: { $event: event } });
}

function handleModel(el, expression, modifiers, getComponent, effect, cleanup) {
  if (el.type === "file") return;

  const property = expression.trim();
  const isCheckbox = el.type === "checkbox";
  const isRadio = el.type === "radio";
  const isSelect = el.tagName === "SELECT";
  const isLazy = modifiers.includes("lazy") || modifiers.includes("change");
  const delay = isLazy ? 0 : parseDuration(modifiers, 250);

  const updateControl = () => {
    const component = getComponent();
    if (!component) return;
    const value = component.get(property);
    if (isCheckbox) {
      el.checked = Array.isArray(value)
        ? value.map(String).includes(el.value)
        : Boolean(value);
    } else if (isRadio) {
      el.checked = String(value) === el.value;
    } else if (isSelect && el.multiple) {
      const values = Array.isArray(value) ? value.map(String) : [];
      for (const option of el.options)
        option.selected = values.includes(option.value);
    } else if (el.value !== String(value ?? "")) {
      el.value = value ?? "";
    }
  };
  effect(updateControl);
  el._fireModelUpdate = updateControl;

  const convert = (value) => {
    if (modifiers.includes("trim")) value = value.trim();
    if (
      modifiers.includes("number") &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
    return value;
  };
  const onInput = () => {
    const component = getComponent();
    if (!component || (isRadio && !el.checked)) return;
    let value;
    if (isCheckbox) {
      const current = component.get(property);
      if (Array.isArray(current)) {
        value = current.filter((item) => String(item) !== el.value);
        if (el.checked) value.push(convert(el.value));
      } else value = el.checked;
    } else if (isSelect && el.multiple) {
      value = Array.from(el.selectedOptions, (option) => convert(option.value));
    } else value = convert(el.value);
    component.set(property, value, delay);
  };
  const event =
    isLazy || isCheckbox || isRadio || isSelect ? "change" : "input";
  el.addEventListener(event, onInput);
  cleanup(() => {
    el.removeEventListener(event, onInput);
    delete el._fireModelUpdate;
  });
}

function handleLoading(
  el,
  expression,
  modifiers,
  getComponent,
  effect,
  cleanup,
) {
  const display = el.style.display;
  const attribute = expression.trim() || "disabled";
  const initialAttribute = el.getAttribute(attribute);
  const classes = expression.trim().split(/\s+/).filter(Boolean);
  const initialClasses = new Map(
    classes.map((name) => [name, el.classList.contains(name)]),
  );
  let timer;

  effect(() => {
    const component = getComponent();
    const target =
      el.getAttribute("fire:target") || el.getAttribute("x-fire:target");
    const active = Boolean(
      component?.loading && (!target || component.loadingTarget === target),
    );
    const apply = () => {
      const show = modifiers.includes("remove") ? !active : active;
      if (modifiers.includes("attr")) {
        if (active) {
          if (show) el.setAttribute(attribute, "");
          else el.removeAttribute(attribute);
        } else if (initialAttribute === null) el.removeAttribute(attribute);
        else el.setAttribute(attribute, initialAttribute);
      } else if (modifiers.includes("class")) {
        for (const name of classes)
          el.classList.toggle(name, active ? show : initialClasses.get(name));
      } else
        el.style.display = show ? (display === "none" ? "" : display) : "none";
    };
    clearTimeout(timer);
    if (active && modifiers.includes("delay"))
      timer = setTimeout(apply, parseDuration(modifiers, 200));
    else apply();
  });
  cleanup(() => clearTimeout(timer));
}

function handlePoll(
  el,
  expression,
  modifiers,
  getComponent,
  evaluate,
  cleanup,
) {
  const interval = parseDuration(modifiers, 5000);
  if (interval <= 0) return;
  let stopped = false;
  let timer;
  const poll = async () => {
    if (stopped || !el.isConnected) return;
    const component = getComponent();
    try {
      if (
        !document.hidden &&
        navigator.onLine !== false &&
        component &&
        !component.loading
      ) {
        if (expression.trim()) await runAction(component, expression, evaluate);
        else await component.send();
      }
    } finally {
      if (!stopped && el.isConnected) timer = setTimeout(poll, interval);
    }
  };
  timer = setTimeout(poll, interval);
  cleanup(() => {
    stopped = true;
    clearTimeout(timer);
  });
}
