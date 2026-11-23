export interface SiteCopy {
  readonly brand: string;
  readonly navLabel: string;
  readonly navHome: string;
  readonly navFeatures: string;
  readonly navPricing: string;
  readonly navAbout: string;
  readonly switchLangLabel: string;
  readonly themeToggleLabel: string;
  readonly themeDark: string;
  readonly themeLight: string;
  readonly homeTitle: string;
  readonly homeDescription: string;
  readonly homeHeroTitle: string;
  readonly homeHeroSubtitle: string;
  readonly homeCta: string;
  readonly homeImageAlt: string;
  readonly featuresTitle: string;
  readonly featuresDescription: string;
  readonly featuresHeading: string;
  readonly featuresLead: string;
  readonly featuresImageAlt: string;
  readonly featuresCards: readonly { readonly id: string; readonly title: string; readonly body: string }[];
  readonly pricingTitle: string;
  readonly pricingDescription: string;
  readonly pricingHeading: string;
  readonly pricingLead: string;
  readonly aboutTitle: string;
  readonly aboutDescription: string;
  readonly aboutHeading: string;
  readonly aboutLead: string;
  readonly aboutImageAlt: string;
  readonly notFoundTitle: string;
  readonly notFoundHeading: string;
  readonly footerText: string;
}

const AR_COPY: SiteCopy = {
  brand: "dotMix",
  navLabel: "التنقل الرئيسي",
  navHome: "الرئيسية",
  navFeatures: "المميزات",
  navPricing: "الأسعار",
  navAbout: "من نحن",
  switchLangLabel: "Français",
  themeToggleLabel: "تبديل المظهر",
  themeDark: "الوضع الداكن",
  themeLight: "الوضع الفاتح",
  homeTitle: "dotMix — مواقع ثابتة سريعة بدون Virtual DOM",
  homeDescription: "منصة حديثة لبناء المواقع الثابتة وتطبيقات الويب بأداء فائق وتجربة ثنائية اللغة.",
  homeHeroTitle: "مواقع ثابتة مترجمة مسبقاً بسرعة فائقة",
  homeHeroSubtitle: "صفحات ثنائية اللغة مع دعم كامل للاتجاه من اليمين إلى اليسار وتحسين تلقائي لمحركات البحث وجزئيات تفاعلية خفيفة.",
  homeCta: "استكشف المميزات",
  homeImageAlt: "معاينة واجهة منصة dotMix للمواقع الثابتة",
  featuresTitle: "المميزات — dotMix",
  featuresDescription: "صفحة تعريفية ثابتة بالكامل تُحمّل صفر بايت من JavaScript مع صور متجاوبة وبيانات منظمة.",
  featuresHeading: "أداء نقي بصفر بايت من JavaScript",
  featuresLead: "هذه الصفحة لا تحتوي على أي جزئيات تفاعلية، لذا يرسل البناء الثابت HTML وCSS فقط.",
  featuresImageAlt: "رسم توضيحي لمعمارية التوليد الثابت بدون متصفح",
  featuresCards: [
    { id: "ssg", title: "توليد ثابت بلا متصفح", body: "بناء جميع المسارات في Node.js مباشرة دون الحاجة إلى Chromium في بيئة البناء." },
    { id: "islands", title: "إرواء جراحي للجزئيات", body: "يتم تفعيل المكونات التفاعلية وحدها مع الحفاظ التام على عقد DOM المولّدة." },
    { id: "seo", title: "تحسين شامل لمحركات البحث", body: "توليد تلقائي لـ hreflang وخريطة الموقع وبيانات JSON-LD الآمنة." }
  ],
  pricingTitle: "الأسعار — dotMix",
  pricingDescription: "خطط شفافة ومجانية مفتوحة المصدر للمطورين والشركات.",
  pricingHeading: "خطط مرنة لكل فريق",
  pricingLead: "إطار العمل مفتوح المصدر بالكامل تحت رخصة MIT مع استضافة ثابتة فائقة السرعة.",
  aboutTitle: "من نحن — dotMix",
  aboutDescription: "تعرف على فريق ورؤية مشروع dotMix لبناء الويب السريع.",
  aboutHeading: "مبني لأداء الويب الحديث",
  aboutLead: "نصمم أدوات تمنح المطورين سرعة المترجمات الأصلية وبساطة الويب القياسي.",
  aboutImageAlt: "مساحة عمل فريق dotMix الهندسي",
  notFoundTitle: "الصفحة غير موجودة — dotMix",
  notFoundHeading: "404 — الصفحة غير موجودة",
  footerText: "© 2026 dotMix. جميع الحقوق محفوظة."
};

const FR_COPY: SiteCopy = {
  brand: "dotMix",
  navLabel: "Navigation principale",
  navHome: "Accueil",
  navFeatures: "Fonctionnalités",
  navPricing: "Tarifs",
  navAbout: "À propos",
  switchLangLabel: "العربية",
  themeToggleLabel: "Changer le thème",
  themeDark: "Mode sombre",
  themeLight: "Mode clair",
  homeTitle: "dotMix — Sites statiques rapides sans Virtual DOM",
  homeDescription: "Plateforme moderne pour générer des sites statiques bilingues ultra-rapides avec SEO intégré.",
  homeHeroTitle: "Des sites statiques compilés à l'avance",
  homeHeroSubtitle: "Pages bilingues RTL/LTR, SEO automatisé et îlots interactifs légers sans hydratation superflue.",
  homeCta: "Découvrir les fonctionnalités",
  homeImageAlt: "Aperçu de la plateforme dotMix pour sites statiques",
  featuresTitle: "Fonctionnalités — dotMix",
  featuresDescription: "Page purement statique livrant 0 octet de JavaScript avec images réactives et JSON-LD.",
  featuresHeading: "Performance pure à 0 octet de JavaScript",
  featuresLead: "Cette page ne contient aucun îlot interactif : seul le HTML et le CSS sont envoyés au navigateur.",
  featuresImageAlt: "Schéma de l'architecture de génération statique sans navigateur",
  featuresCards: [
    { id: "ssg", title: "Génération sans navigateur", body: "Compilation statique complète dans Node.js sans Chromium dans l'image de build." },
    { id: "islands", title: "Îlots d'hydratation ciblée", body: "Seuls les composants interactifs chargent du JavaScript sans recréer le DOM." },
    { id: "seo", title: "SEO et CSP intégrés", body: "Génération automatique des balises hreflang, sitemap.xml, JSON-LD et empreintes CSP." }
  ],
  pricingTitle: "Tarifs — dotMix",
  pricingDescription: "Des offres simples et open source pour vos projets web statiques.",
  pricingHeading: "Des formules adaptées à chaque équipe",
  pricingLead: "Le framework est entièrement open source sous licence MIT pour un déploiement statique instantané.",
  aboutTitle: "À propos — dotMix",
  aboutDescription: "Découvrez la mission et l'architecture du framework dotMix.",
  aboutHeading: "Conçu pour la performance web durable",
  aboutLead: "Nous associons la précision d'un compilateur natif à la simplicité des standards du web.",
  aboutImageAlt: "Espace de travail de l'équipe d'ingénierie dotMix",
  notFoundTitle: "Page introuvable — dotMix",
  notFoundHeading: "404 — Page introuvable",
  footerText: "© 2026 dotMix. Tous droits réservés."
};

export function getCopy(locale: string): SiteCopy {
  return locale === "fr" ? FR_COPY : AR_COPY;
}

