import type { MixConfig } from "@dotmix/cli";

const config: MixConfig = {
  srcDir: "src",
  outDir: "dist",
  site: {
    url: "https://example.dotmix.dev"
  },
  i18n: {
    locales: ["ar", "fr"],
    defaultLocale: "ar",
    prefixDefault: false,
    dir: {
      ar: "rtl",
      fr: "ltr"
    }
  },
  csp: {
    enabled: true,
    target: "cloudflare-pages"
  },
  build: {
    clean: true,
    static: true
  }
};

export default config;

