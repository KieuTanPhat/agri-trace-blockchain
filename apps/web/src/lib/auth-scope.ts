type ScopedUser = {
  id: string;
  role?: { code: string };
  organizationId?: string | null;
  accessRevision?: string;
};

/** Tokens rotate within a scope; role/organization changes invalidate loaded data. */
export function getAuthorizationScope(user?: ScopedUser | null): string {
  return JSON.stringify(
    user
      ? [
          user.id,
          user.role?.code,
          user.organizationId ?? null,
          ...(user.accessRevision ? [user.accessRevision] : []),
        ]
      : null,
  );
}
