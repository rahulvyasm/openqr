import { socialIconSvg } from "../../shared/social.js";
export default function SocialIcon({
  platform = "website",
}: {
  platform?: string;
}) {
  return (
    <span
      className="social-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: socialIconSvg(platform) }}
    />
  );
}
