# إطار عمل dotMix — المعمارية المترجمة للويب

<p align="center">
  <b>تعديل مباشر على DOM · إشارات تفاعلية نقية · بدون Virtual DOM · تصاريح وصلاحيات مدمجة · مزامنة كاملة بدون إنترنت · مكتبة أدوات قياسية صفرية الاعتماديات</b>
</p>

<p align="center">
  <b>العربية</b> | <a href="README.md"><b>English</b></a> | <a href="FEATURES.ar.md"><b>المميزات</b></a>
</p>

---

## ما هو dotMix؟

**dotMix** (`.mix` للغة JavaScript و `.tix` للغة TypeScript الصارمة) هو إطار عمل حديث لواجهات الويب قائم على الترجمة المسبقة (Ahead-Of-Time Compiler-Native UI Framework).

بدلاً من مقارنة شجرة DOM افتراضية أو تفسير القوالب وقت التشغيل، يترجم **dotMix** القوالب مسبقاً (AOT) إلى JavaScript يعدّل DOM الحقيقي مباشرة: لا يُلمس إلا النص أو الخاصية المرتبطة بالإشارة التي تغيّرت.

ويأتي مع نواة تفاعلية دقيقة، ومحرك صلاحيات (RBAC/ABAC)، ومزامنة محلية أولاً عبر CRDT، ومكتبة قياسية بلا اعتماديات خارجية (`@dotmix/helpers`).

---

## أبرز المميزات

| الميزة | كيف يحققها dotMix |
| :--- | :--- |
| **بدون DOM افتراضي** | تعليمات مترجمة تعدّل فقط النص أو الخاصية التي تغيّرت، دون مقارنة أشجار أو تمريرة توفيق. |
| **بلا اعتماديات خارجية وقت التشغيل** | `@dotmix/runtime` بلا أي اعتمادية؛ و`@dotmix/router` و`@dotmix/sync` و`@dotmix/helpers` تعتمد فقط على `@dotmix/runtime`. |
| **صلاحيات RBAC/ABAC مدمجة** | المكوّن `<Can>`، وموضوعات صلاحيات تفاعلية، وإلغاء فحوص الصلاحيات غير المتزامنة، وحراسة المسارات قبل التحميل. (حماية للواجهة فقط؛ يجب فرض الصلاحيات على الخادم أيضاً). |
| **مناطق زمنية بلا قاعدة tzdata** | تحويل المناطق الزمنية IANA في `@dotmix/helpers/datetime` عبر واجهة `Intl` في المنصة، دون تضمين قاعدة بيانات للمناطق. |
| **عميل HTTP** | `@dotmix/helpers/http`: معترضات (interceptors)، وإعادة المحاولة مع التباطؤ، ومنع تكرار الطلبات، والتخزين المؤقت، والخطاف التفاعلي `useHttp`. |
| **حالة CRDT تعمل دون اتصال** | `@dotmix/sync`: مجموعات محلية أولاً مع ساعات Lamport، وفهرسة كسرية، وعمليات موقّعة، وتخزين دائم في IndexedDB. |
| **مفاتيح قوائم آمنة بوضعين** | يعمل `{each}` الضمني مع الكائنات العادية بلا حقل `id` (بهوية المرجع مع فض التكرار تلقائياً)؛ بينما تفرض المفاتيح الصريحة (`{each (x, i, key) in list}` أو `<Each key={...}>`) فرادة المفاتيح الأولية ذرياً وتُفحص وقت الترجمة في `.tix`. |
| **طبقة أخطاء التطوير وحدود الاحتواء** | طبقة أخطاء في المتصفح أثناء `mix dev` بإطار كود مرتبط بالخريطة المصدرية ومكدس المكونات وفتح في المحرر؛ مع حدود أخطاء `{try}`/`<ErrorBoundary>` وشبكة أمان جذرية في الإنتاج بصفر كلفة في `dist/`. |
| **CSS معزول مع المعالجات المسبقة** | ترجمة وقت البناء لملفات `.scss` و`.sass` و`.less` و`.pcss` و`.css` مع عزل على مستوى شجرة AST وفحوص أمان. |
| **فحص TypeScript** | تُفحص مكونات `.tix` (الخصائص، الأنواع العامة، الاستيرادات) بمترجم TypeScript مقابل ملفات `.d.ts` الحقيقية. |
| **توليد المواقع الثابتة وSEO** | بناء ثابت بلا متصفح (`mix build --static`) بصفحات صفرية JavaScript، وجزر تفاعلية تلقائية (`idle`) أو صريحة `{hydrate}` / `<Hydrate>`، وتعدد اللغات `hreflang`، و`useHead` الشامل، و`sitemap.xml`، وسياسة CSP بالبصمات. |

التفاصيل في [FEATURES.ar.md](FEATURES.ar.md).

---

## البدء السريع

> **الحالة: الإصدار 0.4.1.** قد تتطور بعض الواجهات قبل 1.0. للعمل على الإطار نفسه، ابنِه واختبره من هذا المستودع (`npm install` ثم `npm run build` ثم `npm test`).

### 1. إنشاء مشروع جديد

```bash
# مشروع بـ TypeScript و SCSS
npx -p @dotmix/cli@0.4.1 mix create my-app --ts --scss

# أو JavaScript مع CSS عادي
npx -p @dotmix/cli@0.4.1 mix create my-app --js --css
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
├── index.html            # صفحة HTML الأساسية مع نقطة التركيب #root
├── mix.config.ts         # إعدادات المشروع (المجلدات والمسار الأساسي وخيارات dev وbuild)
├── package.json
└── tsconfig.json
```

### 3. أوامر التطوير والإنتاج

```bash
cd my-app

# خادم التطوير مع التحديث الفوري للوحدات (HMR)
npm run dev

# الفحص الثابت للأنواع والتشخيص البرمجي
npm run check

# بناء الإنتاج: وحدة ES مستقلة ببصمة لكل ملف مصدر، وخريطة استيراد، وتقرير بالأحجام
npm run build

# معاينة حزمة الإنتاج محلياً مع توجيه SPA والضغط
npx mix preview

# تشغيل الاختبارات بدون مكتبات خارجية (SSR ومتصفح حقيقي CDP)
npx mix test

# فحص الكود وتصحيح الصياغة القديمة تلقائياً
npx mix lint --fix

# فحص إعداد المشروع بحثاً عن المشكلات الشائعة
npx mix doctor

# فحص وتحديث الحزم بأمان مع تحويلات الصياغة الآلية
npx mix upgrade --dry-run
```

كل الأوامر والخيارات: [docs/CLI.md](docs/CLI.md).

### 4. دعم المحرر (VS Code)

تضيف إضافة `vscode-mix` لملفات `.mix` و `.tix`: تلوين الصياغة، والأخطاء المباشرة، والإكمال التلقائي، والتلميحات، والانتقال إلى التعريف (Ctrl+نقرة). وتتعامل إضافة TypeScript المضمّنة فيها مع استيراد المكونات داخل ملفات `.ts`: يُفحص `import App from "./App.tix"` دون أخطاء، وتفتح Ctrl+نقرة على المسار أو على الاسم المستورد ملفَّ المكوّن.

الإضافة غير منشورة في المتجر بعد. ابنِها وثبّتها من هذا المستودع:

```bash
# في جذر المستودع
npm install
npm run build

# تحزيم الإضافة (ملف .vsix يتضمن خادم اللغة وإضافة TypeScript)
cd editors/vscode-mix
npm run package

# التثبيت مع استبدال أي إصدار أقدم
code --install-extension vscode-mix-0.4.1.vsix --force
```

ثم نفّذ **Developer: Reload Window** (Ctrl+Shift+P، أو Cmd+Shift+P على macOS).

**مشاريع TypeScript.** ينشئ `mix create --ts` الملف `src/env.d.ts`. في مشروع موجود، أنشئه بنفسك:

```ts
// src/env.d.ts
/// <reference types="@dotmix/runtime/client" />
```

يعرّف هذا الملف مكونات `.tix` و `.mix` واستيراد ملفات الأنماط (`import "./App.css";`)، فيقبلها `tsc` والمحررات التي لا تملك الإضافة أيضاً.

**إذا لم يعمل شيء:**

| المشكلة | الحل |
| :--- | :--- |
| `Cannot find module './App.tix'` في ملف `.ts` | تأكد من وجود `src/env.d.ts` وأن `tsconfig.json` يشمله، ثم نفّذ **TypeScript: Restart TS Server**. |
| Ctrl+نقرة لا تفعل شيئاً في ملف `.tix` | تأكد في قائمة الإضافات أن **Mix / Tix Language Support** مثبتة ومفعّلة، ثم نفّذ **dotMix: Restart Language Server**. |
| أخطاء أو سجلات الإضافة | نفّذ **dotMix: Show Output Channel**. |

الدليل الكامل: [docs/VSCODE_EXTENSION_GUIDE.md](docs/VSCODE_EXTENSION_GUIDE.md).

---

## نموذج المكونات

يدعم dotMix كلاً من **JavaScript** (`.mix`) و **TypeScript** الصارمة (`.tix`) بتصميم دوال تفاعلية حديثة وأنيقة:

```tsx
import "./UserProfile.scss";
import { createSignal } from "@dotmix/runtime";
import { Can } from "@dotmix/runtime/permissions";
import { http, useHttp } from "@dotmix/helpers/http";
import { dateTime } from "@dotmix/helpers/datetime";
import { dot } from "@dotmix/helpers/data";

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

## الحزم

| الحزمة | المسؤولية | الاعتماديات |
| :--- | :--- | :---: |
| [`@dotmix/runtime`](packages/runtime) | نواة التفاعلية، محول الـ DOM الجراحي، فحص القوائم، الصلاحيات | **صفر اعتماديات** |
| [`@dotmix/router`](packages/router) | راوتر المسارات عبر Radix-Trie، محملات البيانات، حراسة الصلاحيات | `@dotmix/runtime` فقط |
| [`@dotmix/helpers`](packages/helpers) | المكتبة القياسية المدمجة (`data`, `datetime`, `http`, `async`, `web`) | `@dotmix/runtime` فقط |
| [`@dotmix/sync`](packages/sync) | محرك المزامنة الموزعة وقواعد البيانات دون اتصال (CRDT) | `@dotmix/runtime` فقط |
| [`@dotmix/compiler-frontend`](packages/compiler-frontend) | محلل ومترجم الواجهات واستخراج حدود التعبيرات البرمجية | أدوات التطوير |
| [`@dotmix/compiler-semantic`](packages/compiler-semantic) | تحليل النطاقات وفحص الأنواع عبر TypeScript 6 Compiler API | أدوات التطوير |
| [`@dotmix/compiler-css`](packages/compiler-css) | عزل الأنماط ومعالجة `.scss`, `.sass`, `.less`, `.pcss` | أدوات التطوير |
| [`@dotmix/compiler-codegen`](packages/compiler-codegen) | توليد كود الـ DOM المباشر وخرائط المصدر SourceMaps | أدوات التطوير |
| [`@dotmix/compiler-ssr`](packages/compiler-ssr) | تصيير جهة الخادم مع التفعيل الذكي للإشارات التفاعلية | أدوات التطوير |
| [`@dotmix/stream`](packages/stream) | تدفق معايير الويب WinterCG Edge (`ReadableStream`, `Response`) لبيئات Cloudflare و Deno و Bun | بيئات Edge و Node |
| [`@dotmix/server-node`](packages/server-node) | خادم SSR التدفقي مع تشفير الرموز الأمنية CSP Nonces | بيئة Node |
| [`@dotmix/vite-plugin`](packages/vite-plugin) | إضافة Vite و Rollup الرسمية مع دعم HMR | أدوات التطوير |
| [`@dotmix/cli`](packages/cli) | أداة سطر الأوامر (`mix` و `dotmix`) | أدوات التطوير |
| [`@dotmix/language-server`](packages/language-server) | بروتوكول خادم اللغة (LSP) لدعم محررات VS Code | أدوات التطوير |
| [`@dotmix/diagnostics`](packages/diagnostics) | أصناف التشخيص المشتركة ورموزها ومواضعها في المصدر | أدوات التطوير |
| [`@dotmix/ast`](packages/ast) | أنواع عقد شجرة AST ومواضعها للمترجم | أدوات التطوير |
| [`@dotmix/interop`](packages/interop) | استعمال مكونات dotMix وإشاراتها داخل أطر عمل أخرى | `@dotmix/runtime` فقط |
| [`@dotmix/sanitizer-dompurify`](packages/sanitizer-dompurify) | محول اختياري لتنقية HTML مبني على DOMPurify | `@dotmix/runtime`؛ واعتمادية نظيرة اختيارية `dompurify` |
| [`@dotmix/image`](packages/image) | مكون `<Picture>` الاختياري للصور المتجاوبة وأوضاع العناصر النائبة وتحسين AVIF/WebP | `@dotmix/runtime`؛ واعتمادية نظيرة اختيارية `sharp` |
| [`vscode-mix`](editors/vscode-mix) | إضافة VS Code لملفات `.mix` و `.tix` (غير منشورة في المتجر بعد؛ [دليل التثبيت](#4-دعم-المحرر-vs-code)) | محررات وأدوات التطوير |

---

## المتصفحات وبيئات التشغيل

يستهدف dotMix متصفحات الويب الحديثة وبيئات التشغيل المتطورة:
- **المتصفحات:** Chrome 100+ و Edge 100+ و Firefox 100+ (مختبرة)؛ Safari 15.4+ (متوقع أن يعمل، لم يُختبر بعد). المعيار ES2022.
- **معايير الويب:** قنوات البث `BroadcastChannel`، التشفير الآمن Web Crypto (`crypto.getRandomValues`)، قواعد بيانات IndexedDB و OPFS، وإشارات الإلغاء `AbortSignal`.
- **الخادم والحافة:** Node.js 22+ (مختبر في CI على 22 و24 و26). تستخدم `@dotmix/stream` واجهة Web Streams القياسية، لذا بيئات WinterCG (Cloudflare Workers و Deno و Bun) مستهدفة لكنها لم تُختبر بعد.
- **تنبيه أمني:** قواعد الصلاحيات `@dotmix/runtime/permissions` تحمي تفاعلات واجهة المستخدم وتجربة الاستخدام؛ ويجب دائماً حماية وتوثيق واجهات الـ API في الخوادم بشكل مستقل.

---

## الاختبارات

يخضع مستودع **dotMix** لاختبارات صارمة غير وهمية تغطي 100% من المسارات الأساسية:

```bash
# بناء جميع الحزم
npm run build

# التحقق من القواعد المعمارية والأخطاء اللغوية
npm run lint

# حزمة الاختبارات الكاملة (بلا محاكاة)
npm test

# فحص المسار الذهبي لقوالب التوليد العشرة (TypeScript و JavaScript × 5 صيغ للأنماط)
npm run test:golden

# اختبارات في متصفحات حقيقية (Chrome و Edge و Firefox)
npm run test:browser
npm run test:e2e
```

---

## الترخيص

يُنشر **dotMix** بموجب [رخصة MIT](LICENSE). © 2026 [Chemseddine](https://github.com/chemseddine201) والمساهمون في dotMix.
الترجمة العربية في [LICENSE.ar.md](LICENSE.ar.md) للاطلاع فقط؛ النص الإنجليزي هو المرجع القانوني.

