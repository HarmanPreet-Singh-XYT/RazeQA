/** Shared field-presence check used by both the registration form and the
 * checkout billing-address form — trims whitespace so a field containing
 * only spaces is treated as empty. */
export function isFieldFilled(value: string): boolean {
  return value.trim().length > 0;
}
