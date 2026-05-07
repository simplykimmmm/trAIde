import type { IEToroAdapter } from "./adapter";
import { MockEToroAdapter } from "./mockAdapter";
import { RealEToroAdapter } from "./realAdapter";

export function getEToroAdapter(): IEToroAdapter {
  const publicKey = process.env.ETORO_PUBLIC_KEY ?? process.env.ETORO_API_KEY;

  if (publicKey && process.env.ETORO_USER_KEY && process.env.USE_REAL_ETORO === "true") {
    return new RealEToroAdapter();
  }

  return new MockEToroAdapter();
}
