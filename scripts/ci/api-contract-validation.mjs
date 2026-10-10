export function validateContract(document) {
  const methods = new Set([
    "get",
    "post",
    "patch",
    "put",
    "delete",
    "options",
    "head",
  ]);
  function resolveRef(reference) {
    if (!reference.startsWith("#/"))
      throw new Error(
        `External OpenAPI reference is unsupported: ${reference}`,
      );
    const resolved = reference
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce((value, part) => value?.[part], document);
    if (!resolved)
      throw new Error(`Unresolved OpenAPI reference: ${reference}`);
    return resolved;
  }
  function properties(schema) {
    if (schema?.$ref) return properties(resolveRef(schema.$ref));
    return Object.assign(
      {},
      ...(schema?.allOf ?? []).map(properties),
      schema?.properties,
    );
  }
  function references(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref) resolveRef(value.$ref);
    for (const nested of Object.values(value)) references(nested);
  }
  references(document);
  for (const [name, schema] of Object.entries(
    document.components?.schemas ?? {},
  )) {
    if (
      schema.type === "object" &&
      !Object.keys(schema.properties ?? {}).length &&
      !schema.additionalProperties &&
      !schema.allOf
    )
      throw new Error(`Empty object schema: ${name}`);
  }
  let operations = 0;
  const operationIds = new Set();
  const publicOperations = new Set([
    "get /api",
    "get /api/health",
    "get /api/health/live",
    "get /api/public/trace/{token}",
    "post /api/auth/login",
    "post /api/auth/register",
    "post /api/auth/logout",
  ]);
  for (const [path, item] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      operations += 1;
      if (
        typeof operation.operationId !== "string" ||
        !operation.operationId ||
        operationIds.has(operation.operationId)
      )
        throw new Error(
          `Missing or duplicate operationId: ${method.toUpperCase()} ${path}`,
        );
      operationIds.add(operation.operationId);
      if (
        !publicOperations.has(`${method} ${path}`) &&
        (!operation.security?.length ||
          operation.security.some(
            (requirement) => !Object.keys(requirement).length,
          ))
      )
        throw new Error(
          `${method.toUpperCase()} ${path} is missing security metadata`,
        );
      for (const requirement of operation.security ?? [])
        for (const scheme of Object.keys(requirement))
          if (!document.components?.securitySchemes?.[scheme])
            throw new Error(`Unknown security scheme: ${scheme}`);
      if (
        path.includes("/device-readings") ||
        path.endsWith("/device-telemetry")
      ) {
        if (
          !operation.security?.some((requirement) => "deviceKey" in requirement)
        )
          throw new Error(
            `${method.toUpperCase()} ${path} is missing device authentication`,
          );
      }
      const success = Object.entries(operation.responses ?? {}).filter(
        ([code]) => /^2\d\d$/.test(code),
      );
      if (!success.length && path !== "/api/auth/register")
        throw new Error(
          `${method.toUpperCase()} ${path} has no success contract`,
        );
      for (const [code, response] of success) {
        const schema = response.content?.["application/json"]?.schema;
        const fields = properties(schema);
        if (
          ["success", "data", "timestamp", "requestId"].some(
            (field) => !fields[field],
          )
        )
          throw new Error(
            `${method.toUpperCase()} ${path} ${code} is missing its response envelope/schema`,
          );
        assertSchema(fields.data, `${method} ${path} response data`);
      }
      const needsKey =
        (method === "post" && !path.startsWith("/api/auth/")) ||
        (method === "patch" && path === "/api/certificates/{id}/review");
      if (
        needsKey &&
        !(operation.parameters ?? []).some(
          (parameter) =>
            parameter.in === "header" &&
            parameter.name.toLowerCase() === "idempotency-key" &&
            parameter.required,
        )
      )
        throw new Error(
          `${method.toUpperCase()} ${path} must document required Idempotency-Key`,
        );
      if (
        operation.requestBody &&
        !operation.requestBody.content?.["application/json"]?.schema
      )
        throw new Error(
          `${method.toUpperCase()} ${path} is missing a JSON request schema`,
        );
      if (operation.requestBody)
        assertSchema(
          operation.requestBody.content["application/json"].schema,
          `${method} ${path} request`,
        );
      for (const status of ["400", "500"]) {
        const response = operation.responses?.[status];
        const fields = properties(
          response?.content?.["application/json"]?.schema,
        );
        if (
          ["success", "error", "timestamp", "path", "requestId"].some(
            (field) => !fields[field],
          )
        )
          throw new Error(
            `${method} ${path} ${status} is missing its error envelope`,
          );
      }
    }
  function assertSchema(schema, context, visited = new Set()) {
    if (
      !schema ||
      typeof schema !== "object" ||
      !Object.keys(schema).some((key) =>
        ["$ref", "type", "enum", "allOf", "oneOf", "anyOf"].includes(key),
      )
    )
      throw new Error(`Empty schema: ${context}`);
    if (schema.$ref) {
      if (visited.has(schema.$ref)) return;
      visited.add(schema.$ref);
      return assertSchema(resolveRef(schema.$ref), context, visited);
    }
    for (const group of ["allOf", "oneOf", "anyOf"])
      for (const member of schema[group] ?? [])
        assertSchema(member, context, visited);
    if (schema.type === "array") {
      // Arbitrary JSON array elements intentionally use {}. Require this to be
      // explicit rather than accepting an entirely missing items schema.
      if (!schema.items) throw new Error(`Missing array items: ${context}`);
      if (Object.keys(schema.items).length)
        assertSchema(schema.items, context, visited);
    }
    if (
      schema.type === "object" &&
      !schema.properties &&
      !schema.additionalProperties &&
      !schema.enum &&
      !schema.allOf &&
      !schema.oneOf &&
      !schema.anyOf
    )
      throw new Error(`Empty object schema: ${context}`);
  }
  const forbidden = new Set([
    "actorAuthProof",
    "authProofType",
    "businessData",
    "documentRef",
    "reviewNote",
    "passwordHash",
    "refreshToken",
    "authorizationScope",
    "deviceId",
    "readings",
    "submittedByUserId",
    "recordedByUserId",
    "actorUserId",
    "actorOrganizationId",
  ]);
  const visited = new Set();
  function publicProjection(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref && !visited.has(value.$ref)) {
      visited.add(value.$ref);
      publicProjection(resolveRef(value.$ref));
    }
    for (const field of Object.keys(value.properties ?? {}))
      if (forbidden.has(field))
        throw new Error(`PublicLotDto must not expose ${field}`);
    for (const nested of Object.values(value)) publicProjection(nested);
  }
  publicProjection(document.components?.schemas?.PublicLotDto);
  if (!operations || !document.components?.schemas?.PublicLotDto)
    throw new Error("Incomplete OpenAPI document");
  return operations;
}
