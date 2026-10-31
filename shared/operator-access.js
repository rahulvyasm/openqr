const all = [
  "overview:read",
  "workspaces:read",
  "users:read",
  "activity:read",
  "operations:read",
  "backup:create",
  "sessions:revoke",
  "staff:manage",
  "billing:manage",
  "cases:manage",
  "accounts:manage",
  "audit:read",
  "entitlements:override",
];
export const staffRoles = [
  {
    id: "super_admin",
    label: "Super Admin",
    department: "Leadership",
    description:
      "Manage company staff, customer access, operations, and hosted plans.",
    permissions: all,
  },
  {
    id: "operations",
    label: "Operations",
    department: "Infrastructure",
    description:
      "Monitor workspaces and runtime, review activity, and create backups.",
    permissions: [
      "overview:read",
      "workspaces:read",
      "activity:read",
      "operations:read",
      "backup:create",
    ],
  },
  {
    id: "support",
    label: "Support",
    department: "Customer support",
    description:
      "Find customer accounts, work support cases, reveal contact details with a recorded reason, suspend or restore accounts, and revoke sessions.",
    permissions: [
      "overview:read",
      "workspaces:read",
      "users:read",
      "activity:read",
      "sessions:revoke",
      "cases:manage",
      "accounts:manage",
    ],
  },
  {
    id: "billing",
    label: "Billing",
    department: "Finance",
    description:
      "Review workspace usage, manage hosted plan entitlements, and resolve billing and subscription cases.",
    permissions: [
      "overview:read",
      "workspaces:read",
      "billing:manage",
      "cases:manage",
    ],
  },
  {
    id: "analyst",
    label: "Analyst",
    department: "Insights",
    description:
      "Read aggregate installation analytics without customer directories or management actions.",
    permissions: ["overview:read"],
  },
];
export const staffPermissions = (role) =>
  staffRoles.find((item) => item.id === role)?.permissions || [];
