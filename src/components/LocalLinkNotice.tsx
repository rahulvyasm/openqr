import { Globe } from "lucide-react";

export function isLoopbackUrl(value: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(value).hostname,
    );
  } catch {
    return false;
  }
}
export default function LocalLinkNotice({ url }: { url: string }) {
  if (!isLoopbackUrl(url)) return null;
  return (
    <div className="info-note amber local-link-notice" role="status">
      <Globe size={19} />
      <div>
        <strong>This QR points to your computer’s localhost.</strong>
        <p>
          A phone’s localhost points to the phone, so this link will not reach
          OpenQR. Hosted pages and editable links need a reachable server
          address. Set PUBLIC_URL to your permanent HTTPS domain before
          printing, or use a reachable LAN address for same-network testing.
        </p>
        <p>
          For one social profile, a static Website QR can open the profile
          directly without this server.
        </p>
      </div>
    </div>
  );
}
