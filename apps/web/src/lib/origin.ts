/** Origin phones should use. In dev on the laptop (localhost), point phones at the LAN address instead. */
export function publicOrigin(): string {
  const { hostname, origin } = window.location;
  if (__LAN_ORIGIN__ && (hostname === "localhost" || hostname === "127.0.0.1")) return __LAN_ORIGIN__;
  return origin;
}
