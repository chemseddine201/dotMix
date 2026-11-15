import { createForm, validators } from "@dotmix/runtime";

export interface SignupValues {
  email: string;
  name: string;
}

export function createSignupForm() {
  return createForm<SignupValues>({
    initialValues: { email: "", name: "" },
    validators: {
      email: [validators.required("Email is required"), validators.email("Enter a valid email address")],
      name: [validators.required("Name is required")]
    }
  });
}
