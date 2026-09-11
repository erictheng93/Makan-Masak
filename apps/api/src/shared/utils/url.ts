import { z } from "zod";

export const httpUrlSchema = z.lazy(() =>
  z.url().refine((value) => {
    try {
      const protocol = new URL(value).protocol.toLowerCase();
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must use http or https"),
);
