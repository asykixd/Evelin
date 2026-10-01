import type { FarmApi } from "../shared/types";

declare global {
  interface Window {
    farm: FarmApi;
  }
}

export {};
