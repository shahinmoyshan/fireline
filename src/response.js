export const ResponseType = {
  VALIDATION: "validation",
  RENDER: "render",
  REDIRECT: "redirect",
  NAVIGATE: "navigate",
  SUCCESS: "success",
  ERROR: "error",
  MESSAGE: "message",
  UNEXPECTED: "unexpected",
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function parseResponse(response) {
  const envelope = {
    type: ResponseType.UNEXPECTED,
    status: response.status,
    message: null,
    errors: {},
    html: null,
    title: null,
    redirect: null,
    navigate: null,
    raw: null,
    rawHtml: null,
  };
  // Let stream failures reach the request handler so aborts/timeouts stay aborts.
  const text = await response.text();
  envelope.rawHtml = text;
  const mime = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    mime !== "application/json" &&
    !/^application\/[\w.+-]+\+json$/.test(mime)
  )
    return envelope;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return envelope;
  }
  envelope.raw = data;
  if (!object(data)) return envelope;
  const message = typeof data.message === "string" ? data.message : null;
  envelope.message = message;
  if (response.status === 422 && object(data.errors)) {
    envelope.type = ResponseType.VALIDATION;
    envelope.message = message ?? "Validation failed.";
    envelope.errors = Object.fromEntries(
      Object.entries(data.errors).map(([field, errors]) => [
        field,
        (Array.isArray(errors) ? errors : [errors]).filter(
          (error) => typeof error === "string",
        ),
      ]),
    );
  } else if (!response.ok) {
    if (message !== null) envelope.type = ResponseType.ERROR;
  } else if (typeof data.redirect === "string" && data.redirect) {
    envelope.type = ResponseType.REDIRECT;
    envelope.redirect = data.redirect;
  } else if (typeof data.navigate === "string" && data.navigate) {
    envelope.type = ResponseType.NAVIGATE;
    envelope.navigate = data.navigate;
  } else if (typeof data.html === "string") {
    envelope.type = ResponseType.RENDER;
    envelope.html = data.html;
    envelope.title = typeof data.title === "string" ? data.title : null;
  } else if (data.status === "success") {
    envelope.type = ResponseType.SUCCESS;
  } else if (data.status === "error") {
    envelope.type = ResponseType.ERROR;
  } else if (message !== null) {
    envelope.type = ResponseType.MESSAGE;
  }
  return envelope;
}
