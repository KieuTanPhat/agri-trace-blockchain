/**
 * Same-origin OpenStreetMap tiles for the route map. Some networks cannot resolve
 * the public tile host; the server fetches the tile once and lets browsers and
 * the edge cache it, so the map renders wherever the site itself is reachable.
 */
const UPSTREAM = "https://tile.openstreetmap.org";
const MAX_ZOOM = 19;
const DAY = 86_400;

function tileCoordinates(z: string, x: string, y: string) {
  const file = /^(\d{1,7})\.png$/.exec(y);
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !file) return null;
  const zoom = Number(z), column = Number(x), row = Number(file[1]);
  const size = 2 ** zoom;
  if (zoom > MAX_ZOOM || column >= size || row >= size) return null;
  return { zoom, column, row };
}

export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const tile = tileCoordinates(z, x, y);
  if (!tile) return new Response(null, { status: 404 });
  try {
    const upstream = await fetch(`${UPSTREAM}/${tile.zoom}/${tile.column}/${tile.row}.png`, {
      headers: { "User-Agent": "AgriTrace route map tile proxy" },
      next: { revalidate: DAY },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok || !upstream.headers.get("content-type")?.startsWith("image/png"))
      return new Response(null, { status: 502 });
    return new Response(await upstream.arrayBuffer(), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 504 });
  }
}
