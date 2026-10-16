// "Connect your phone": one entry in the account menu that opens the phone
// pairing this window can actually do. A Cloud customer once found only this
// computer's pairing and could not see how to reach their Cloud from the
// phone, so the entry names where the phone will connect.
//
// - this computer (the desktop app on its own computer): the phone flow in
//   Settings → Remote access, which pairs with this computer's companion;
// - the person's own OMB Cloud (open in this window, or a browser): that
//   Cloud's own Remote access pairing code;
// - any other server: its pairing code, only for a session that may make one.
//
// On this computer, someone with a paid Cloud that is Ready is offered both:
// their Cloud first (always on), then this computer.
//
// Vopwe trim: local-only, the Cloud destination is never offered.
import type { LocaleKey } from "@/locales";
import type { Action } from "@/state/store";
import { readMembership } from "./membership";
import { isOwnerOrAdmin, readSessionState, type SessionState } from "./session";

export type PhonePairingTarget = "computer" | "cloud" | "server";

export const phonePairingSettingsAction = (): Extract<Action, { type: "toggleAppSettings" }> => ({
  type: "toggleAppSettings",
  open: true,
  section: "companion",
  phonePairing: true,
});

export function currentPhonePairingTarget(cloudHome: boolean): PhonePairingTarget {
  const ogb = typeof window === "undefined" ? undefined : (window.ogb as { companion?: unknown; remoteClient?: { active?: boolean } } | undefined);
  return phonePairingTarget({ companion: Boolean(ogb?.companion), remoteClient: ogb?.remoteClient?.active === true, cloudHome });
}

export function phonePairingTarget(input: { companion: boolean; remoteClient: boolean; cloudHome: boolean }): PhonePairingTarget {
  if (input.cloudHome) return "cloud";
  return input.companion && !input.remoteClient ? "computer" : "server";
}

export interface PhonePairingAccess {
  session: SessionState | null;
  pairingCodes: boolean;
}

export interface ConnectPhoneEntry {
  target: PhonePairingTarget;
  subtitleKey: LocaleKey;
}

const SUBTITLE: Record<PhonePairingTarget, LocaleKey> = {
  computer: "sidebar.menu.connectPhone.computer",
  cloud: "sidebar.menu.connectPhone.cloud",
  server: "sidebar.menu.connectPhone.server",
};

export function connectPhoneEntry(target: PhonePairingTarget, access: PhonePairingAccess | null): ConnectPhoneEntry | null {
  if (target !== "computer" && !(access && access.pairingCodes && isOwnerOrAdmin(access.session))) return null;
  return { target, subtitleKey: SUBTITLE[target] };
}

export type CloudPhoneDestination = "ready" | "not-ready" | null;

export function cloudPhoneDestination(_account: unknown): CloudPhoneDestination {
  return null;
}

export interface PhoneDestination extends ConnectPhoneEntry {
  id: "cloud" | "here";
  noteKey?: LocaleKey;
}

export function phoneDestinations(entry: ConnectPhoneEntry | null, cloud: CloudPhoneDestination): PhoneDestination[] {
  if (!entry) return [];
  const here: PhoneDestination = { ...entry, id: "here" };
  if (entry.target !== "computer" || !cloud) return [here];
  if (cloud === "not-ready") return [{ ...here, noteKey: "sidebar.menu.connectPhone.cloudNotReady" }];
  return [{ id: "cloud", target: "cloud", subtitleKey: "sidebar.menu.connectPhone.cloudAlwaysOn" }, here];
}

let pending: Promise<PhonePairingAccess> | null = null;

export function loadPhonePairingAccess(fetchImpl: typeof fetch = fetch): Promise<PhonePairingAccess> {
  pending ??= readSessionState(fetchImpl).then(async (session): Promise<PhonePairingAccess> => {
    if (!isOwnerOrAdmin(session)) return { session, pairingCodes: false };
    const config: unknown = await fetchImpl("/api/config", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    return { session, pairingCodes: readMembership(config).pairingCodes };
  });
  return pending;
}

export function resetPhonePairingAccess(): void {
  pending = null;
}

const PHONE_PAIRING_ACTION = "data-phone-pairing-action";

interface PairingRoot {
  scrollIntoView?: (options: ScrollIntoViewOptions) => void;
  querySelector: (selector: string) => { focus: (options?: FocusOptions) => void } | null;
  focus: (options?: FocusOptions) => void;
}

/** Deferred a frame: Settings settles its own scroll position after its sections' effects run. */
export function revealPhonePairing(
  root: PairingRoot | null,
  schedule: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
): boolean {
  if (!root) return false;
  schedule(() => {
    root.scrollIntoView?.({ block: "start" });
    (root.querySelector(`[${PHONE_PAIRING_ACTION}]:not([disabled])`) ?? root).focus({ preventScroll: true });
  });
  return true;
}

/** `?desktop-settings=phone` only opens Settings on the phone pairing; it never makes a code by itself. */
export function takePhonePairingRequest(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get("desktop-settings") !== "phone") return null;
  url.searchParams.delete("desktop-settings");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function pairedDestination(search: string): string {
  return new URLSearchParams(search).get("desktop-settings") === "phone" ? "/?desktop-settings=phone" : "/";
}
