export const hostedPlans = [
  {
    id: "free",
    name: "Free",
    description: "A first home for your connections.",
    codes: 25,
    storageBytes: 100 * 1024 ** 2,
    members: 3,
  },
  {
    id: "plus",
    name: "Plus",
    description: "Room to launch, learn, and grow.",
    codes: 1000,
    storageBytes: 5 * 1024 ** 3,
    members: 10,
  },
  {
    id: "pro",
    name: "Pro",
    description: "More space for ambitious teams.",
    codes: 10000,
    storageBytes: 50 * 1024 ** 3,
    members: 50,
  },
];

// Retain existing grants when an installation upgrades from the old tier names.
export const canonicalTier = (tier) =>
  ({ creator: "plus", business: "pro" })[tier] || tier;
