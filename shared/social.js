export const socialPlatforms = [
  {
    id: "website",
    label: "Website",
    hosts: [],
    placeholder: "https://your-website.com",
  },
  {
    id: "instagram",
    label: "Instagram",
    hosts: ["instagram.com"],
    placeholder: "https://www.instagram.com/yourname/",
  },
  {
    id: "facebook",
    label: "Facebook",
    hosts: ["facebook.com", "fb.com", "fb.me"],
    placeholder: "https://www.facebook.com/yourpage",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    hosts: ["linkedin.com", "lnkd.in"],
    placeholder: "https://www.linkedin.com/in/yourname/",
  },
  {
    id: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "youtu.be"],
    placeholder: "https://www.youtube.com/@yourchannel",
  },
  {
    id: "tiktok",
    label: "TikTok",
    hosts: ["tiktok.com"],
    placeholder: "https://www.tiktok.com/@yourname",
  },
  {
    id: "x",
    label: "X",
    hosts: ["x.com", "twitter.com"],
    placeholder: "https://x.com/yourname",
  },
  {
    id: "github",
    label: "GitHub",
    hosts: ["github.com"],
    placeholder: "https://github.com/yourname",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    hosts: ["pinterest.com", "pin.it"],
    placeholder: "https://www.pinterest.com/yourname/",
  },
  {
    id: "telegram",
    label: "Telegram",
    hosts: ["t.me", "telegram.me", "telegram.org"],
    placeholder: "https://t.me/yourname",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hosts: ["wa.me", "whatsapp.com"],
    placeholder: "https://wa.me/15551234567",
  },
  {
    id: "discord",
    label: "Discord",
    hosts: ["discord.com", "discord.gg"],
    placeholder: "https://discord.gg/yourinvite",
  },
];

export function socialLinkError(link) {
  const platform = socialPlatforms.find(
    (item) => item.id === (link.platform || "website"),
  );
  if (!platform) return "Choose a supported social platform.";
  let url;
  try {
    url = new URL(link.url);
  } catch {
    return "Enter a complete HTTP or HTTPS URL.";
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    /[\s\\]/.test(link.url)
  )
    return "Use a complete HTTP or HTTPS URL without spaces or credentials.";
  if (platform.id !== "website") {
    if (url.protocol !== "https:") return `Use HTTPS for ${platform.label}.`;
    if (
      !platform.hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith("." + host),
      )
    )
      return `Use a ${platform.label} link (${platform.hosts.join(" or ")}), or choose Website.`;
  }
  return "";
}

export function socialUrlKey(value) {
  const url = new URL(value);
  return url.origin + url.pathname.replace(/\/+$/, "") + url.search + url.hash;
}

const paths = {
  website:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
  facebook:
    '<path d="M14.5 21v-8h3l.5-4h-3.5V7c0-1 .3-1.5 1.7-1.5H18V2.2c-.7-.1-1.6-.2-2.8-.2C12.3 2 10 3.8 10 7v2H7v4h3v8z" fill="currentColor" stroke="none"/>',
  linkedin:
    '<path d="M5 9v11M10 20V9h4v1.5c1-2.5 6-2.4 6 2.5v7M14 13v7" stroke-width="3"/><circle cx="5" cy="5" r="1.7" fill="currentColor" stroke="none"/>',
  youtube:
    '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 6 3-6 3z" fill="currentColor" stroke="none"/>',
  tiktok:
    '<path d="M14 3v12.5a4.5 4.5 0 1 1-4-4.47M14 3c1 4 3 5 7 5" stroke-width="3"/>',
  x: '<path d="M4 3h4l12 18h-4zM20 3 4 21"/>',
  github:
    '<path d="M8 20v-3c-4 1-4-2-5-2M16 20v-3c0-1-.5-2-1-2 5-.5 6-7 2-9V3l-4 2h-2L7 3v3c-4 2-3 8 2 9-.5.5-1 1-1 2"/><path d="M8 20a9 9 0 1 1 8 0"/>',
  pinterest:
    '<circle cx="12" cy="12" r="9"/><path d="m9 21 3-13M10 14c5 6 10-6 4-7-5-2-8 5-5 7"/>',
  telegram: '<path d="m3 10 18-7-4 18-6-6-4 3v-5zM7 13 18 6l-7 9"/>',
  whatsapp:
    '<path d="m4 17-1 5 5-2a9 9 0 1 0-4-3z"/><path d="M8 7c-2 2 5 9 7 7l1-2-3-1-1 1-2-2 1-1-1-3z"/>',
  discord:
    '<path d="M8 5 5 6C3 9 2 13 3 17l5 2 1-2h6l1 2 5-2c1-4 0-8-2-11l-3-1-1 2H9z"/><circle cx="8.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
};
export function socialIconSvg(platform = "website") {
  const body = Object.hasOwn(paths, platform) ? paths[platform] : paths.website;
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
