export const socialPlatforms: {
  id: string;
  label: string;
  hosts: string[];
  placeholder: string;
}[];
export function socialLinkError(link: {
  platform?: string;
  url: string;
}): string;
export function socialUrlKey(value: string): string;
export function socialIconSvg(platform?: string): string;
