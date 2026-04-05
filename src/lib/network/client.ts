import { PRIVATE_APP_HOSTNAME, PUBLIC_APP_HOSTNAME } from "./hosts";

export { PRIVATE_APP_HOSTNAME, PUBLIC_APP_HOSTNAME };

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
