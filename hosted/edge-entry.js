import { createHostedHandler } from "./api.js";
const env = Object.fromEntries(
  [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].map((key) => [key, Deno.env.get(key)]),
);
Deno.serve(createHostedHandler(env));
