export function getApplicationStatusPath(
  applicationId: string,
  applicationSecret: string,
): string {
  return `/status/${encodeURIComponent(applicationId)}#${encodeURIComponent(applicationSecret)}`;
}

export function getApplicationSecretFromHash(hash: string): string | null {
  const encodedSecret = hash.startsWith("#") ? hash.slice(1) : hash;

  if (!encodedSecret) {
    return null;
  }

  try {
    const secret = decodeURIComponent(encodedSecret);
    return secret || null;
  } catch {
    return null;
  }
}
