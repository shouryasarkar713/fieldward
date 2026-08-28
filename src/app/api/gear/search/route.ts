import { db } from "@/lib/db";
import { parseTags, toGearDTO } from "@/lib/gear";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/gear/search?q=<text>&limit=<n>
 * Free-text match against gear name, description, and tags. The query is
 * split into terms (so "waterproof boots" finds waterproof boots, not just
 * the literal phrase) and results are ranked by how many terms matched where
 * — name > tags > description.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limitParam = searchParams.get("limit");

    if (query === null || query.trim().length === 0) {
      return errorResponse(400, 'Query parameter "q" is required.');
    }

    let limit = 10;
    if (limitParam !== null) {
      const parsed = Number.parseInt(limitParam, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        return errorResponse(400, 'Query parameter "limit" must be a positive integer.');
      }
      limit = Math.min(parsed, 50);
    }

    // Split into terms; drop empties and cap the count to keep the OR
    // predicate sane. SQLite `contains` maps to LIKE (ASCII case-insensitive).
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .slice(0, 8);
    if (terms.length === 0) {
      return errorResponse(400, 'Query parameter "q" is required.');
    }

    const gear = await db.gearItem.findMany({
      where: {
        source: "catalog",
        OR: terms.flatMap((term) => [
          { name: { contains: term } },
          { description: { contains: term } },
          { tags: { contains: term } },
        ]),
      },
    });

    const scored = gear
      .map((item) => {
        const name = item.name.toLowerCase();
        const description = item.description.toLowerCase();
        const tags = parseTags(item.tags)
          .map((tag) => tag.toLowerCase())
          .join(" ");
        let score = 0;
        for (const term of terms) {
          if (name.includes(term)) score += 3;
          if (tags.includes(term)) score += 2;
          if (description.includes(term)) score += 1;
        }
        return { item, score };
      })
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
      .slice(0, limit);

    return Response.json({
      query,
      count: scored.length,
      results: scored.map(({ item }) => toGearDTO(item)),
    });
  } catch (error) {
    console.error("[api/gear/search]", error);
    return errorResponse(500, "Something went wrong searching the gear library.");
  }
}
