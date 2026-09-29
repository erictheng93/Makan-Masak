// The guide's source of truth is docs/user-manuals; public/guide/ is a build-time copy (gitignored).
import { cpSync, mkdirSync } from "node:fs";
const src = new URL(
  "../../../docs/user-manuals/onboarding-self-apply-guide.html",
  import.meta.url,
);
const dir = new URL("../public/guide/", import.meta.url);
mkdirSync(dir, { recursive: true });
cpSync(src, new URL("onboarding-self-apply-guide.html", dir));
