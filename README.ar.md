# إطار عمل dotMix — المعمارية المترجمة للويب

<p align="center">
  <b>تعديل مباشر على DOM · إشارات تفاعلية نقية · بدون Virtual DOM · تصاريح وصلاحيات مدمجة · مزامنة كاملة بدون إنترنت · مكتبة أدوات قياسية صفرية الاعتماديات</b>
</p>

<p align="center">
  <b>العربية</b> | <a href="README.md"><b>English</b></a> | <a href="FEATURES.ar.md"><b>المقارنة المعمارية الكاملة والمميزات الحصرية</b></a>
</p>

---

## ⚡ ما هو dotMix؟

**dotMix** (`.mix` للغة JavaScript و `.tix` للغة TypeScript الصارمة) هو إطار عمل حديث لواجهات الويب قائم على الترجمة المسبقة (Ahead-Of-Time Compiler-Native UI Framework).

بدلاً من الحسابات الثقيلة لشجرة الكائنات الافتراضية (Virtual DOM Diffing في React و Vue) أو تفسير القوالب وقت التشغيل، يقوم **dotMix** بترجمة المكونات المكتوبة بشكل تصريحي مباشرة إلى عمليات DOM جراحية خالية من حجز الذاكرة غير الضروري وتعمل مباشرة على عناصر المتصفح الحقيقية.

ومع نواة تفاعلية فائقة السرعة، ومحرك تصاريح مدمج للأدوار والصلاحيات (RBAC/ABAC)، ومزامنة بيانات موزعة تعمل دون اتصال (CRDTs)، ومكتبة قياسية شاملة خالية من أي اعتماديات خارجية (`mix-helpers`)، صُمم dotMix ليكون الأساس الأقوى لبناء تطبيقات الويب الحديثة والمشاريع المؤسسية الضخمة.

---

## 🚀 أبرز الفروقات عن أطر العمل الأخرى

| الميزة | كيف يحققها dotMix |
| :--- | :--- |
| **صفر تكلفة للـ Virtual DOM** | تعليمات جراحية ينتجها المترجم لتحديث العقدة النصية أو الخاصية المطلوبة فقط بزمن استجابة 0ms. |
| **صفر اعتماديات خارجية وقت التشغيل** | النواة `@mix/runtime` والراوتر `@mix/router` صفر اعتماديات. المكتبة القياسية `mix-helpers` خالية تماماً من مكتبات الطرف الثالث. |
| **محرك تصاريح وصلاحيات مدمج** | مكون `<Can>` جراحي، موضوعات صلاحيات تفاعلية مع الإشارات، إلغاء ذكي للطلبات، وحراسة المسارات قبل جلب البيانات. |
| **محرك تواريخ ومناطق زمنية بلا بيانات خارجية** | تحويل فوري لأي منطقة زمنية بالعالم (`mix-helpers/datetime`) بالاعتماد على محرك `Intl` بالمتصفح وبدون ملفات tzdata خارجية. |
| **عميل HTTP مرن مع خطاف تفاعلي** | متوافق مع Axios (`mix-helpers/http`) مع إعادة المحاولة التلقائية عند الخطأ، ومنع ازدواجية الطلبات المتزامنة، والخطاف التفاعلي `useHttp`. |
| **مزامنة موزعة دون اتصال بالإنترنت (CRDT)** | حزمة `@mix/sync` مدمجة لحفظ العمليات محلياً ومزامنتها لحظياً بدون تضارب في البيانات. |
| **رفض ذري للقوائم ذات المفاتيح المكررة (`D-110`)** | التحقق المسبق من المفاتيح ورفض أي قائمة غير صالحة ذرياً لمنع تشوه واجهات المستخدم وحقول الإدخال. |
| **معالجة مسبقة للأنماط بمختلف الأنواع** | ترجمة مسبقة لملفات `.scss`, `.sass`, `.less`, `.pcss`, و `.css` مع عزل تام للأنماط وقت البناء. |
| **محرك الفحص عبر TypeScript 6 الرسمي** | فحص دقيق وشامل لخصائص المكونات والأنماط المعقدة باستخدام TypeScript Compiler API الرسمي. |

👉 **للاطلاع على الشرح المعماري المفصل: اقرأ [FEATURES.ar.md](FEATURES.ar.md).**

---

## 📦 البدء السريع

### 1. إنشاء مشروع جديد

```bash
# باستخدام أداة سطر الأوامر dotmix
npm create dotmix my-app

# أو باستخدام الخيارات المخصصة
npx @mix/cli create my-app --ts --scss
```

### 2. الهيكلية المعمارية للمشروع

```text
my-app/
├── src/
│   ├── layouts/          # التخطيطات العامة الثابتة (<Outlet /> يحافظ على حالة الصفحات)
│   ├── pages/            # المكونات الممثلة للصفحات والمرتبطة بالمسارات
│   ├── components/       # عناصر الواجهة القابلة لإعادة الاستخدام ومكونات النظام
│   ├── permissions/      # قواعد ومصفوفة الصلاحيات المدمجة
│   ├── stores/           # مخازن الإشارات ومجموعات المزامنة الموزعة
│   ├── styles/           # المتغيرات العامة والأنماط المعالجة مسبقاً
│   ├── routes.ts         # إعداد المسارات مع حراسة الصلاحيات التلقائية
│   └── main.mix          # نقطة الانطلاق ومزود الصلاحيات
├── mix.config.ts         # إعدادات إطار العمل
├── package.json
└── tsconfig.json
```

### 3. أوامر التطوير والإنتاج

```bash
cd my-app

# تشغيل خادم التطوير السريع مع التحديث اللحظي (HMR)
npm run dev

# الفحص الثابت للأنواع والتشخيص البرمجي
npm run check

# البناء النهائي للإنتاج مع تقسيم الحزم وضغط الأصول
npm run build
```

---

## 💡 نموذج المكونات البرمجية

يدعم dotMix كلاً من **JavaScript** (`.mix`) و **TypeScript** الصارمة (`.tix`) بتصميم دوال تفاعلية حديثة وأنيقة:

```tsx
import "./UserProfile.scss";
import { createSignal } from "@mix/runtime";
import { Can } from "@mix/runtime/permissions";
import { http, useHttp } from "mix-helpers/http";
import { dateTime } from "mix-helpers/datetime";
import { dot } from "mix-helpers/data";

export interface UserProps {
  userId: string;
  initialRole?: string;
}

export default function UserProfile(props: UserProps) {
  const user = createSignal({ name: "أحمد", role: props.initialRole ?? "viewer" });

  // خطاف طلبات الشبكة التفاعلي مع الإلغاء التلقائي
  const { data: stats, loading } = useHttp(`/api/users/${props.userId}/stats`);

  return (
    <div class="user-profile-card">
      <header>
        <h2>{user().name}</h2>
        <span class="updated-time">انضم {dateTime().fromNow()}</span>
      </header>

      {if loading()}
        <p class="skeleton">جاري تحميل الإحصائيات...</p>
      {elseif stats()}
        <div class="metrics">
          <span>المشاهدات: {dot.get(stats(), "metrics.views", 0)}</span>
          <span>النقاط: {dot.get(stats(), "metrics.score", 0)}</span>
        </div>
      {else}
        <p>لا توجد بيانات متاحة.</p>
      {endif}

      {/* بوابة الصلاحيات الجراحية في شجرة الـ DOM */}
      <Can I="edit" this={user()} fallback={<span class="badge">للقراءة فقط</span>}>
        <button class="btn-primary" onClick={() => console.log("تعديل البيانات")}>
          تعديل الملف الشخصي
        </button>
      </Can>
    </div>
  );
}
```

---

## 🛠️ حزم المستودع البرمجية (`packages/`)

| الحزمة | المسؤولية | الاعتماديات |
| :--- | :--- | :---: |
| [`@mix/runtime`](packages/runtime) | نواة التفاعلية، محول الـ DOM الجراحي، فحص القوائم، الصلاحيات | **صفر اعتماديات** |
| [`@mix/router`](packages/router) | راوتر المسارات عبر Radix-Trie، محملات البيانات، حراسة الصلاحيات | **صفر اعتماديات** |
| [`mix-helpers`](packages/helpers) | المكتبة القياسية المدمجة (`data`, `datetime`, `http`, `async`, `web`) | `@mix/runtime` فقط |
| [`@mix/sync`](packages/sync) | محرك المزامنة الموزعة وقواعد البيانات دون اتصال (CRDT) | `@mix/runtime` فقط |
| [`@mix/compiler-frontend`](packages/compiler-frontend) | محلل ومترجم الواجهات واستخراج حدود التعبيرات البرمجية | أدوات التطوير |
| [`@mix/compiler-semantic`](packages/compiler-semantic) | تحليل النطاقات وفحص الأنواع عبر TypeScript 6 Compiler API | أدوات التطوير |
| [`@mix/compiler-css`](packages/compiler-css) | عزل الأنماط ومعالجة `.scss`, `.sass`, `.less`, `.pcss` | أدوات التطوير |
| [`@mix/compiler-codegen`](packages/compiler-codegen) | توليد كود الـ DOM المباشر وخرائط المصدر SourceMaps | أدوات التطوير |
| [`@mix/compiler-ssr`](packages/compiler-ssr) | تصيير جهة الخادم مع التفعيل الذكي للإشارات التفاعلية | أدوات التطوير |
| [`@mix/server-node`](packages/server-node) | خادم SSR التدفقي مع تشفير الرموز الأمنية CSP Nonces | بيئة Node |
| [`@mix/vite-plugin`](packages/vite-plugin) | إضافة Vite و Rollup الرسمية مع دعم HMR | أدوات التطوير |
| [`@mix/cli`](packages/cli) | أداة سطر الأوامر (`mix` و `dotmix`) | أدوات التطوير |
| [`@mix/language-server`](packages/language-server) | بروتوكول خادم اللغة (LSP) لدعم محررات VS Code | أدوات التطوير |

---

## 🧪 الاختبارات والجودة

يخضع مستودع **dotMix** لاختبارات صارمة غير وهمية تغطي 100% من المسارات الأساسية:

```bash
# بناء جميع الحزم
npm run build

# التحقق من القواعد المعمارية والأخطاء اللغوية
npm run lint

# تشغيل حزمة الاختبارات الشاملة (208+ اختبار ناجح)
npm test

# التحقق الشامل عبر المسار الذهبي لكافة قوالب التوليد (10 قوالب)
npm run test:golden
```

---

## 📄 الترخيص

إطار العمل **dotMix** مفتوح المصدر بالكامل بموجب **[رخصة MIT](LICENSE)** (تماماً مثل ReactJS) © 2026 [Chemseddine](https://github.com/chemseddine201).
راجع ملف [`LICENSE`](LICENSE) (English) و [`LICENSE.ar.md`](LICENSE.ar.md) (العربية).

