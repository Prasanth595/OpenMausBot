/** A wait with a follow-up a bot set up from chat; Cancel stops it until it settles. */
export interface WaitCardData {
  waitId: string;
  label: string;
  followUp: string;
  settled?: "fired" | "expired" | "cancelled";
}
