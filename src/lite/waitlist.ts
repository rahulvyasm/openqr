// Optional early-access list kept in a Supabase table through its REST API.
// Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; see docs/LITE_SITE.md.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const waitlistEnabled = !!url && !!key;

export async function joinWaitlist(email: string): Promise<void> {
  if (!url || !key) throw new Error("The list is not open yet.");
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) || clean.length > 200)
    throw new Error("Enter a valid email address.");
  const res = await fetch(`${url}/rest/v1/waitlist`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ email: clean, source: "lite-site" }),
  });
  // A repeat sign-up is fine: the person is already on the list.
  if (res.status === 409) return;
  if (!res.ok) throw new Error("Could not join the list. Please try again later.");
}
