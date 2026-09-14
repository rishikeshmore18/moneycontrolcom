// Best-effort mapping from a bank transaction to one of the user's own categories.
const KEYWORDS: Record<string, string[]> = {
  Groceries: ["grocer", "supermarket", "food_and_drink_groceries", "market"],
  Dining: ["restaurant", "dining", "fast_food", "coffee", "cafe", "food_and_drink"],
  Transport: [
    "transport",
    "gas",
    "fuel",
    "uber",
    "lyft",
    "taxi",
    "parking",
    "transit",
    "travel",
  ],
  Shopping: ["merchandise", "shop", "retail", "amazon", "clothing", "general_merchandise"],
  Entertainment: ["entertainment", "recreation", "movie", "netflix", "spotify", "game"],
  Utilities: ["utilit", "electric", "water", "internet", "phone", "cable"],
  Rent: ["rent", "mortgage", "housing"],
  Health: ["health", "medical", "pharmacy", "doctor", "dental", "fitness", "gym"],
  Insurance: ["insurance"],
  Subscriptions: ["subscription", "membership"],
  Transfer: ["transfer", "payment", "loan"],
};

export function guessCategory(
  hints: (string | null | undefined)[],
  categories: string[],
): string {
  const hay = hints.filter(Boolean).join(" ").toLowerCase().replace(/_/g, " ");
  if (!hay) return fallback(categories);

  // 1. A user category whose own name appears in the transaction text.
  const direct = categories.find((c) => c.length > 3 && hay.includes(c.toLowerCase()));
  if (direct) return direct;

  // 2. Keyword buckets, matched back onto the user's category list.
  for (const [bucket, words] of Object.entries(KEYWORDS)) {
    if (!words.some((w) => hay.includes(w.replace(/_/g, " ")))) continue;
    const match = categories.find(
      (c) => c.toLowerCase() === bucket.toLowerCase() || c.toLowerCase().includes(bucket.toLowerCase()),
    );
    if (match) return match;
  }
  return fallback(categories);
}

function fallback(categories: string[]): string {
  return (
    categories.find((c) => c.toLowerCase() === "miscellaneous") ??
    categories.find((c) => c.toLowerCase() === "other") ??
    categories[0] ??
    "Miscellaneous"
  );
}
