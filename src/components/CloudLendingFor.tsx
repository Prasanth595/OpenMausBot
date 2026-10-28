import { useEffect, useState } from "react";
import type { CloudLendingBridge } from "../../electron/computer-sharing.mjs";
import { t } from "@/lib/i18n";
import { CloudLending } from "./CloudLending";
import { Select } from "./Select";

type Places = Awaited<ReturnType<NonNullable<CloudLendingBridge["places"]>>>;

/** This computer's lending card, for the Cloud chosen above it once the person has two Clouds or more of their own. Main
 * lists the Clouds from the verified sign-in and keeps the choice; the page names one only by the id main gave it. */
export function CloudLendingFor({ bridge, moving = false }: { bridge: CloudLendingBridge; moving?: boolean }) {
  const [places, setPlaces] = useState<Places | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void bridge.places?.().then((next) => { if (alive) setPlaces(next); }, () => {});
    return () => { alive = false; };
  }, [bridge]);
  const choose = (id: string) => {
    if (!bridge.choose || !places || id === places.chosen) return;
    setFailed(false);
    void bridge.choose(id).then(() => setPlaces({ ...places, chosen: id }), () => setFailed(true));
  };
  return <>
    {places && places.places.length > 1 && <label data-lending-for className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
      {t("lending.forCloud")}
      <Select size="sm" value={places.chosen} onChange={(event) => choose(event.target.value)}>
        {places.places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
      </Select>
    </label>}
    {failed && <p role="alert" className="text-[13px] text-danger">{t("cloudAccount.actionFailed")}</p>}
    <CloudLending key={places?.chosen ?? "home"} bridge={bridge} moving={moving}
      cloudName={places && places.chosen !== "home" ? places.places.find((place) => place.id === places.chosen)?.name ?? null : null} />
  </>;
}
