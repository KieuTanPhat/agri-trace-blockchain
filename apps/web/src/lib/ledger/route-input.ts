export type LedgerRouteInput = Readonly<{
  params: Readonly<Record<string, string | string[]>>;
  searchParams: Readonly<Record<string, string | string[] | undefined>>;
}>;

export type LedgerScreenProps = { route: LedgerRouteInput };

export async function resolveLedgerRouteInput(input: {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<LedgerRouteInput> {
  const [params, searchParams] = await Promise.all([
    input.params ?? Promise.resolve({}),
    input.searchParams ?? Promise.resolve({}),
  ]);
  return { params, searchParams };
}
