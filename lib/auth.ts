export function requireAuth(request: Request) {
  const expected = process.env.APP_TOKEN?.trim();

  if (!expected) {
    return null;
  }

  const auth = request.headers.get("authorization");

  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
