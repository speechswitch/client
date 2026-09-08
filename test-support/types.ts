/** Compare types exactly; use `true satisfies Equal<Actual, Expected>` in type checks. */
export type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends (<T>() => T extends Expected ? 1 : 2)
    ? true
    : false;
