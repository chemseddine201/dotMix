/**
 * Gate 21 (D-124): Reactive Typed Form & Validation Engine Suite
 *
 * Verifies:
 * 1. `createForm` initializes per-field signals (value, error, touched, dirty, validating)
 * 2. Composable sync validators (required, minLength, maxLength, pattern, email)
 * 3. Async validator with CancellationToken cancellation on rapid input updates
 * 4. Form-level derived signals (values, errors, isValid, isDirty, isSubmitting)
 * 5. handleSubmit marks fields touched, awaits in-flight async validators, and executes onSubmit
 * 6. reset() restores initial state and cleans up pending validations
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createForm,
  validators
} from "../../packages/runtime/dist/index.js";

describe("Gate 21: Reactive Typed Forms & Validation (@mix/runtime/forms)", () => {
  test("1. Initializes per-field signals and updates value/dirty state", () => {
    const form = createForm({
      initialValues: {
        username: "initialUser",
        age: 25
      }
    });

    const userField = form.field("username");
    assert.strictEqual(userField.value(), "initialUser");
    assert.strictEqual(userField.dirty(), false);
    assert.strictEqual(userField.touched(), false);
    assert.strictEqual(userField.error(), null);

    // Update value
    userField.setValue("newArchitect");
    assert.strictEqual(userField.value(), "newArchitect");
    assert.strictEqual(userField.dirty(), true);
    assert.strictEqual(form.isDirty(), true);
    assert.strictEqual(form.values().username, "newArchitect");

    // Reset restores initial state
    userField.reset();
    assert.strictEqual(userField.value(), "initialUser");
    assert.strictEqual(userField.dirty(), false);
    assert.strictEqual(form.isDirty(), false);
  });

  test("2. Built-in sync validators enforce rules and populate error signals", () => {
    const form = createForm({
      initialValues: {
        email: "",
        password: ""
      },
      validators: {
        email: [validators.required("Email required"), validators.email("Must be valid email")],
        password: [validators.required(), validators.minLength(8, "Password too short")]
      }
    });

    const emailField = form.field("email");
    const passField = form.field("password");

    // Initially clean
    assert.strictEqual(form.isValid(), true);

    // Trigger blur on empty required field
    emailField.blur();
    assert.strictEqual(emailField.touched(), true);
    assert.strictEqual(emailField.error(), "Email required");
    assert.strictEqual(form.isValid(), false);

    // Input invalid email
    emailField.setValue("invalid-email");
    assert.strictEqual(emailField.error(), "Must be valid email");
    assert.strictEqual(form.isValid(), false);

    // Input valid email
    emailField.setValue("lead@mix.framework");
    assert.strictEqual(emailField.error(), null);

    // Test password minLength
    passField.setValue("secret");
    assert.strictEqual(passField.error(), "Password too short");
    assert.strictEqual(form.isValid(), false);

    passField.setValue("supersecret123");
    assert.strictEqual(passField.error(), null);
    assert.strictEqual(form.isValid(), true);
  });

  test("3. Async validators support CancellationToken and abort superseded keystrokes", async () => {
    let cancelledCount = 0;
    let validatedCallCount = 0;

    const form = createForm({
      initialValues: {
        handle: ""
      },
      asyncValidators: {
        handle: async (val, token) => {
          validatedCallCount++;
          token.onCancelled(() => {
            cancelledCount++;
          });

          await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
          if (token.isCancelled) return null;

          if (val === "taken") {
            return "Handle is already taken";
          }
          return null;
        }
      }
    });

    const handleField = form.field("handle");

    // Type rapidly: "t", "ta", "tak", "taken"
    handleField.setValue("t");
    assert.strictEqual(handleField.validating(), true);

    handleField.setValue("ta");
    handleField.setValue("tak");
    handleField.setValue("taken");

    // Wait for the final async validation to complete (70ms)
    await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

    assert.strictEqual(cancelledCount, 3, "Prior 3 keystrokes should be cancelled via CancellationToken");
    assert.strictEqual(validatedCallCount, 4, "Total 4 initial validation calls dispatched");
    assert.strictEqual(handleField.validating(), false);
    assert.strictEqual(handleField.error(), "Handle is already taken");
    assert.strictEqual(form.isValid(), false);

    // Change to available handle
    handleField.setValue("unique_handle");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

    assert.strictEqual(validatedCallCount, 5, "Total 5 validation calls dispatched after unique_handle");
    assert.strictEqual(handleField.error(), null);
    assert.strictEqual(form.isValid(), true);
  });

  test("4. handleSubmit marks all fields touched, validates, and runs onSubmit", async () => {
    let submittedData = null;

    const form = createForm({
      initialValues: {
        title: "",
        category: "engineering"
      },
      validators: {
        title: validators.required("Title is mandatory")
      },
      onSubmit: async (values) => {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
        submittedData = values;
      }
    });

    // Submitting when invalid fails and marks fields touched
    const success1 = await form.handleSubmit();
    assert.strictEqual(success1, false);
    assert.strictEqual(form.field("title").touched(), true);
    assert.strictEqual(form.field("title").error(), "Title is mandatory");
    assert.strictEqual(submittedData, null);

    // Fill valid data
    form.field("title").setValue("Implement Gate 21");
    assert.strictEqual(form.field("title").error(), null);
    assert.strictEqual(form.isValid(), true);

    // Submitting valid form succeeds
    const submitPromise = form.handleSubmit();
    assert.strictEqual(form.isSubmitting(), true);

    const success2 = await submitPromise;
    assert.strictEqual(success2, true);
    assert.strictEqual(form.isSubmitting(), false);
    assert.deepStrictEqual(submittedData, {
      title: "Implement Gate 21",
      category: "engineering"
    });
  });

  test("5. setValues and reset operate across all fields atomically", () => {
    const form = createForm({
      initialValues: {
        firstName: "Ada",
        lastName: "Lovelace"
      }
    });

    form.setValues({
      firstName: "Grace",
      lastName: "Hopper"
    });

    assert.strictEqual(form.values().firstName, "Grace");
    assert.strictEqual(form.values().lastName, "Hopper");
    assert.strictEqual(form.isDirty(), true);

    form.reset();
    assert.strictEqual(form.values().firstName, "Ada");
    assert.strictEqual(form.values().lastName, "Lovelace");
    assert.strictEqual(form.isDirty(), false);
  });
});
