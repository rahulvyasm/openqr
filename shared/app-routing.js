export function appDestination(data, userAgent = "") {
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
  return (
    (ios ? data.iosUrl : /Android/i.test(userAgent) ? data.androidUrl : null) ||
    data.fallbackUrl
  );
}
