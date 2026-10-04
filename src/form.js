import { formSubmission } from "./page";

export function createForm(initialData = {}) {
  return {
    ...initialData,
    processing: false,
    message: null,
    errors: {},
    status: null,

    reset() {
      this.message = null;
      this.errors = {};
      this.status = null;
    },

    submit(formEl) {
      formSubmission(formEl, this);
    },

    hasError(field) {
      return (
        this.errors &&
        Object.prototype.hasOwnProperty.call(this.errors, field) &&
        Array.isArray(this.errors[field]) &&
        this.errors[field].length > 0
      );
    },

    firstError(field) {
      if (this.hasError(field)) {
        return this.errors[field][0];
      }
      return null;
    },
  };
}
