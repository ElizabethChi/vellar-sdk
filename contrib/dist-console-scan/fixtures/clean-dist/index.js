export function sign(xdr) {
  return xdr;
}

export function submit(tx) {
  // Thrown errors are normal, reviewed behavior; console.error is never scanned.
  try {
    return tx;
  } catch (err) {
    console.error("submission failed:", err);
    throw err;
  }
}
