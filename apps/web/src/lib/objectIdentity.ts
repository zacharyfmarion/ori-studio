const identities = new WeakMap<object, number>();
let nextIdentity = 1;

/**
 * A number that names an object for as long as it lives. The same object always
 * gets the same number and no two live objects share one, so it can stand in
 * for the object anywhere a value is wanted instead of a reference — a React
 * `key` that says "this is a different image", for one.
 */
export function identityOf(object: object): number {
  let identity = identities.get(object);
  if (identity === undefined) {
    identity = nextIdentity;
    nextIdentity += 1;
    identities.set(object, identity);
  }
  return identity;
}
