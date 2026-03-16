export const PUBLIC_APP_HOSTNAME = "tachyon.lolwierd.com";
export const PRIVATE_APP_HOSTNAME = "tachyon-ts.lolwierd.com";

export function buildHostSwitchUrl(currentHref: string, targetHost: string) {
  const url = new URL(currentHref);
  url.protocol = "https:";
  url.host = targetHost;
  return url.toString();
}

export function isPrivateHost(hostname: string) {
  return hostname === PRIVATE_APP_HOSTNAME;
}

export function isPublicHost(hostname: string) {
  return hostname === PUBLIC_APP_HOSTNAME;
}
