export const staffRoles: {
  id: string;
  label: string;
  department: string;
  description: string;
  permissions: string[];
}[];
export function staffPermissions(role: string): string[];
