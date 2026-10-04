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

export async function parseResponse(fetchResponse) {
  const envelope = {
    type: ResponseType.UNEXPECTED,
    status: fetchResponse.status,
    message: null,
    errors: {},
    html: null,
    title: null,
    redirect: null,
    navigate: null,
    raw: null,
    rawHtml: null,
  };

  const contentType = fetchResponse.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const data = await fetchResponse.json();
      envelope.raw = data;

      if (fetchResponse.status === 422 && data.errors) {
        envelope.type = ResponseType.VALIDATION;
        envelope.message = data.message || "Validation failed.";
        envelope.errors = data.errors;
      } else if (data.html) {
        envelope.type = ResponseType.RENDER;
        envelope.html = data.html;
        envelope.title = data.title || null;
      } else if (data.redirect) {
        envelope.type = ResponseType.REDIRECT;
        envelope.redirect = data.redirect;
      } else if (data.navigate) {
        envelope.type = ResponseType.NAVIGATE;
        envelope.navigate = data.navigate;
      } else if (data.status === "success") {
        envelope.type = ResponseType.SUCCESS;
        envelope.message = data.message || null;
      } else if (data.status === "error" && data.message) {
        envelope.type = ResponseType.ERROR;
        envelope.message = data.message;
      } else if (data.message) {
        envelope.type = ResponseType.MESSAGE;
        envelope.message = data.message;
      } else {
        envelope.type = ResponseType.UNEXPECTED;
        envelope.rawHtml = JSON.stringify(data, null, 2);
      }
    } catch (e) {
      envelope.type = ResponseType.UNEXPECTED;
      envelope.rawHtml = "Failed to parse JSON response: " + e.message;
    }
  } else {
    envelope.type = ResponseType.UNEXPECTED;
    try {
      envelope.rawHtml = await fetchResponse.text();
    } catch (e) {
      envelope.rawHtml = "Unable to read response body.";
    }
  }

  return envelope;
}
