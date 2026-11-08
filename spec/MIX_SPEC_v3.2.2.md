# Mix — المواصفات المصحّحة v3.2.2 (Corrected Specification)

> **الحالة:** مرشّحة للتجميد (Freeze Candidate). تُجمَّد نهائياً فقط عندما تنجح جميع اختبارات المطابقة في §9 ويُحسم البندان المعلّقان في §0.3.
> **تحلّ محل:** v3.2.1 — Final Contract Corrections.
> **التاريخ:** 2026-11-08
> **تحقّق مسبق:** الخوارزميات والعقود المعلّمة بـ ✅ في هذه الوثيقة شُغّلت فعلياً (نموذج مرجعي + `tsc` + محللات حقيقية) قبل كتابتها. انظر الملحقين B و C.

---

## 0. تعليمات للوكيل (Antigravity) — اقرأ هذا القسم أولاً

### 0.1 لغة المواصفة

| الكلمة | المعنى |
|---|---|
| **يجب** (MUST) | إلزامي. مخالفته خطأ تنفيذ. |
| **يُمنع** (MUST NOT) | محظور قطعاً. |
| **يُستحسن** (SHOULD) | الافتراضي، ولا يُخالف إلا بسبب موثّق في `spec/DECISIONS.md`. |
| `// FROZEN` | كتلة كود تُنسخ حرفياً: الأسماء والتواقيع والأنواع لا تتغير. |
| سطر دالة أو ثابت ينتهي بـ `;` بلا جسم داخل كتلة FROZEN في ملف `.ts` | **توقيع إلزامي** يُنفَّذ بجسم في الملف نفسه بالتوقيع نفسه. **يُمنع** نسخه بلا جسم (الخطأ TS2391). الاستثناء: ملفات `.d.ts` حيث يُكتب `declare`. |

### 0.2 قواعد العمل

1. نفّذ **مرحلة واحدة** من §11 في كل مهمة. ابدأ كل مهمة بخطة تنفيذ (Implementation Plan) تسرد الملفات التي ستُنشأ أو تُعدَّل، ومعرّفات الاختبارات التي ستغطيها، ثم انتظر الموافقة قبل كتابة الكود.
2. لكل قاعدة معرّف (مثل `R-RX-04`). **يجب** أن يحمل اسم الاختبار الذي يغطيها المعرّف نفسه، أو معرّف الاختبار من §9 (مثل `T-RX-05`).
3. **يُمنع** اختراع سلوك غير موصوف. عند حالة غير مغطاة: توقّف واسأل. وإن تعذّر السؤال، اختر السلوك الأكثر تحفّظاً، وسجّله كقرار مؤقت في `spec/DECISIONS.md` مع سببه.
4. **يُمنع** الانتقال إلى المرحلة التالية قبل نجاح: اختبارات المرحلة، وفحص الأنواع، والـ lint.
5. **يُمنع** تعديل ملفات `spec/` إلا بإضافة قرارات إلى `spec/DECISIONS.md`.
6. **يُمنع** إضافة تبعيات خارج القائمة في §1.3 دون موافقة.
7. إذا كان المستودع يحتوي بنية أو إطار اختبار مختلفاً عمّا في §1، فالتزم بالموجود وطابق **المسؤوليات** لا المسارات.

### 0.3 بنود معلّقة (BLOCKED)

- **البندان 11 و12** من قائمة الإصلاحات الأربعة عشر في v3.2.1 غير موجودين في الوثيقة. الأقسام هناك غطّت فقط [1، 2، 3، 4، 5، 6، 7، 8، 9، 10، 13، 14].
- **على الوكيل:** عدم تنفيذ أي شيء يُفترض أنه من البندين 11 و12، والإبلاغ إن صادف كوداً أو توثيقاً يشير إليهما.
- **على صاحب المشروع:** إضافة نص البندين هنا قبل التجميد النهائي.

### 0.4 سجل التغييرات عن v3.2.1

| # | المشكلة في v3.2.1 | الإصلاح في v3.2.2 | القسم |
|---|---|---|---|
| 1 | البندان 11 و12 مفقودان | مُعلَّمان صراحةً كبنود معلّقة | §0.3 |
| 2 | الـ Effect هو Owner وComputation معاً، فيتصادم الحقل `state` بين تعدادين | `ownerState` للـ Owner و`state` للحوسبة | §2.1 |
| 3 | تناقض في 1-ب: «يُمنع منعاً باتاً» ثم «يُعاد الجدولة» | السماح بالكتابة مع إعادة التشغيل وحدّ أقصى للتكرار | §2.4 |
| 4 | `finally { state = CLEAN }` يمسح حالة DIRTY | `if (state === RUNNING) state = CLEAN; else requeue` ✅ | §2.3 |
| 5 | `const enum` يرفضه `erasableSyntaxOnly` (TS1294) و`isolatedModules` عند الاستهلاك (TS2748) ✅ | كائنات `as const` مع أنواع اتحاد | §2.1 |
| 6 | `export function createRoot(...): T;` بلا جسم = الخطأ TS2391 ✅ | نوع في `types.ts` وتنفيذ في `owner.ts` | §2.5 |
| 7 | AbortController اعتُبر «Browser API»، والمحوّل وُضع في `/dom` فلا يجده SSR | تنفيذ نقي في النواة، والتوافق في `@mix/runtime/platform` | §3 |
| 8 | «Acorn/ESTree مع عدّ الأقواس»: ESTree ليس محللاً، وAcorn وحده لا يحلل TS، وعدّ الأقواس يخطئ في 4 من 8 حالات ✅ | `parseExpressionAt` مع إضافة TS و`preserveParens: true` ✅ | §4.1 |
| 9 | «مقارنة نصوص الـ AST» لوسم الإغلاق غير معرّفة | مقارنة تسلسل الـ tokens، وتعبير الإغلاق لا يُقيَّم أبداً | §4.2 |
| 10 | `VerifyRef<T>(ref)` يستنتج T من الـ ref نفسه فلا يتحقق من شيء | شاهد نوع العنصر مع `NoInfer` ✅ | §5.1 |
| 11 | `VerifyProps` بلا `NoInfer` يفوّت الخطأ الإملائي في اسم الخاصية ✅ | `props: NoInfer<P>` مع object literal مباشر ✅ | §5.1 |
| 12 | «تجاهل الامتداد» يولّد استيراداً بلا امتداد يكسر ESM الأصلي | `.tix` → `.tix.js` صراحةً | §5.2 |
| 13 | (جديد) TypeScript 7.0 بلا واجهة برمجية | أدوات `.tix` تعمل على واجهة TS 6 حتى استقرار 7.1 | §5.3 |
| 14 | ربط المقاطع المولّدة بـ«أقرب سطر» مضلِّل | جدول مقاطع بثلاثة أنواع، والخطأ الداخلي = خطأ مترجم | §5.4 |
| 15 | وصف srcset لا يطابق WHATWG، والفحص لا يطبّع الرابط | خوارزمية WHATWG مع `new URL()` ✅ | §6.1–6.2 |
| 16 | `url(x)` بلا اقتباس هو `url-token` لا Function ✅، وفحص قيم ديناميكية «وقت الترجمة» مستحيل، وحظر `url()` كلياً يكسر حالات شائعة | فحص بالـ tokenizer وقت التشغيل، والتحقق من الرابط بدل الحظر ✅ | §6.3 |
| 17 | `createTrustedHtml` يدّعي «تنقية فعالة»، وعلامة الـ Symbol قابلة للتزوير إن كانت `Symbol.for` أو مُصدَّرة | سجل `WeakSet`، وتحذير canary، وقيود سياق الإدراج، ودعم Trusted Types | §6.4 |
| 18 | حذف العنصر ذي المفتاح المكرر بصمت في الإنتاج = فقدان بيانات | تمييز التكرار بالترتيب، وعرض كل العناصر | §7 |
| 19 | الاعتماد على `NODE_ENV` وtelemetry مدمج | علم `__DEV__` من المترجم، و hook باسم `onWarning` | §1.4، §7 |
| 20 | HMR عبر `bind` لا يُصلح الـ closures، والقرار «إما… أو» غير محسوم | نطاق حالة يولّده المترجم + trampolines | §8 |

---

## 1. البنية العامة والاتفاقيات

### 1.1 الحزم ونقاط الدخول

| نقطة الدخول | المسؤولية | القيود |
|---|---|---|
| `@mix/runtime` (core) | التفاعلية، الـ Owner، المجدول، الإلغاء، الأخطاء | ECMAScript فقط + `console`. **يُمنع** أي Web API أو Node API |
| `@mix/runtime/security` | سياسة الروابط، srcset، فحص CSS، `createTrustedHtml` | ECMAScript + `URL` |
| `@mix/runtime/dom` | العرض في DOM، الخصائص، الأنماط، القوائم بمفاتيح، إدراج HTML موثوق | يعتمد على DOM |
| `@mix/runtime/platform` | `toAbortSignal` / `fromAbortSignal` | يتطلب `AbortController` العام (متاح في المتصفحات وNode وDeno وBun والـ Workers) |
| `@mix/runtime/typecheck` | تصريحات أنواع فقط للـ projection | ملفات `.d.ts` فقط، **يُمنع** أي كود تشغيل |
| `@mix/runtime/hmr` | تحديث المكونات في وضع التطوير | لا يدخل في بناء الإنتاج |
| `@mix/compiler` | المحلل، الـ Resolver، الـ Projection، توليد الكود، جدول المقاطع | — |
| `@mix/tsc` + إضافة المحرر | فحص الأنواع لملفات `.tix` من سطر الأوامر والمحرر | انظر §5.3 |

### 1.2 إعدادات TypeScript

```jsonc
// tsconfig.base.json — FROZEN
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,      // يمنع enum وnamespace وparameter properties
    "module": "nodenext",
    "moduleResolution": "nodenext",  // يفرض امتدادات صريحة في الاستيرادات
    "target": "es2022",
    "declaration": true,
    "sourceMap": true
  }
}
```

- **R-TS-01:** يُمنع `enum` و`const enum` و`namespace` في كل الحزم. البديل: كائن `as const` + نوع اتحاد.
- **R-TS-02:** الحد الأدنى لإصدار TypeScript عند المستهلك هو **5.4**، لأن العقود تستخدم `NoInfer`.
- **R-TS-03:** **يجب** أن يحتوي `package.json` في كل حزمة على `"type": "module"`. بدونه، مع `module: nodenext`، تُعامَل ملفات `.ts` كـ CommonJS، ويرفض `verbatimModuleSyntax` كل `export` (الخطأ TS1287 ✅).

### 1.3 التبعيات المسموح بها

| الحزمة | الاستخدام | أين |
|---|---|---|
| `acorn` + `@sveltejs/acorn-typescript` | تحليل التعبيرات (§4) | المترجم |
| `@csstools/css-tokenizer` | فحص قيم CSS (§6.3) | security |
| `typescript` (واجهة 6.x عبر alias، انظر §5.3) | الـ projection وفحص الأنواع | الأدوات فقط |
| `@volar/language-core` و`@volar/typescript` | إضافة المحرر (اختياري) | الأدوات فقط |
| `vitest` + `jsdom` | الاختبارات | dev |

### 1.4 أعلام البناء

- **R-BLD-01:** `__DEV__` ثابت منطقي يعرّفه المترجم أو إضافة الـ bundler وقت البناء.
- **R-BLD-02:** يُمنع على الـ runtime قراءة `process.env.NODE_ENV`، فهي غير موجودة في المتصفح أصلاً.
- **R-BLD-03:** تُنشر نسختا تطوير وإنتاج عبر شروط `exports` في `package.json`: `"development"` و`"production"`، ويكون `"default"` هو الإنتاج.

### 1.5 الأخطاء والإعدادات

```ts
// packages/runtime/src/core/errors.ts — FROZEN
export class MixError extends Error {
  readonly code: MixErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  constructor(code: MixErrorCode, message?: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message ? `${code}: ${message}` : code, options);
    this.name = "MixError";
    this.code = code;
    this.details = details;
  }
}
export const MIX_ERROR_CODES = [ /* كل الرموز في §10 بالترتيب نفسه */ ] as const;
export type MixErrorCode = (typeof MIX_ERROR_CODES)[number];
```

```ts
// packages/runtime/src/core/config.ts — FROZEN
export interface MixWarning { readonly code: MixErrorCode; readonly message: string; readonly details?: Record<string, unknown>; }
export interface SecurityViolation { readonly code: MixErrorCode; readonly attribute?: string; readonly value: string; }

export interface RuntimeConfig {
  scheduler: (flush: () => void) => void;      // الافتراضي: (f) => { Promise.resolve().then(f); }
  maxEffectRunsPerFlush: number;               // الافتراضي: 100
  onUncaughtError: (err: unknown) => void;     // الافتراضي: يُرمى بعد انتهاء الـ flush
  onWarning: (w: MixWarning) => void;          // الافتراضي: console.warn في __DEV__، ولا شيء في الإنتاج
  onSecurityViolation: (v: SecurityViolation) => void; // الافتراضي: onWarning
}
export function configureRuntime(partial: Partial<RuntimeConfig>): void;
```

- **R-CFG-01:** لا telemetry مدمج في Mix. كل التقارير تمر عبر `onWarning` و`onSecurityViolation` و`onUncaughtError`.

---

## 2. النواة التفاعلية (Reactivity Core)

### 2.1 الأنواع — FROZEN ✅

```ts
// packages/runtime/src/core/types.ts — FROZEN
export const ComputationState = { CLEAN: 0, CHECK: 1, DIRTY: 2, RUNNING: 3 } as const;
export type ComputationState = (typeof ComputationState)[keyof typeof ComputationState];

export const OwnerState = { ACTIVE: 0, DISPOSED: 1 } as const;
export type OwnerState = (typeof OwnerState)[keyof typeof OwnerState];

export interface Owner {
  readonly kind: "Root" | "Component" | "Effect";
  parent: Owner | null;
  children: Set<Owner> | null;
  context: Map<symbol, unknown> | null;          // مفاتيح symbol فقط (انظر R-OW-09)
  scopeCleanups: (() => void)[] | null;
  errorHandlers: ((err: unknown) => boolean)[] | null;
  ownerState: OwnerState;                        // ← كان `state` في v3.2.1
}

export type Equals<T> = false | ((a: T, b: T) => boolean);

export interface SourceNode {
  observers: Set<ObserverNode> | null;
}

export interface Computation {
  state: ComputationState;
  sources: SourceNode[];                         // مرتبة حسب أول قراءة في آخر تشغيل، بلا تكرار
}

export interface SignalNode<T = unknown> extends SourceNode {
  readonly kind: "Signal";
  value: T;
  equals: Equals<T>;
}

export interface ComputedNode<T = unknown> extends SourceNode, Computation {
  readonly kind: "Computed";
  fn: (prev: T | undefined) => T;
  value: T | undefined;
  equals: Equals<T>;
  error: { readonly value: unknown } | null;     // الخطأ المخزّن مؤقتاً
  owner: Owner | null;                           // للبحث في السياق وتوجيه الأخطاء فقط؛ الـ Computed ليس Owner
}

export interface EffectNode extends Owner, Computation {
  readonly kind: "Effect";
  fn: () => void;
  runsInFlush: number;
}

export type ObserverNode = ComputedNode | EffectNode;

export type CreateRoot = <T>(fn: (dispose: () => void) => T, detachedParent?: Owner | null) => T;
```

### 2.2 الثوابت (Invariants)

- **I-1:** ترتيب الوسم هو `CLEAN(0) < CHECK(1) < DIRTY(2)`. حالة `RUNNING` لها معاملة خاصة (R-RX-04).
- **I-2:** مصفوفة `sources` مرتبة حسب أول قراءة في آخر تشغيل، ولا تحتوي تكراراً.
- **I-3:** تكون العقدة ضمن `src.observers` إذا وفقط إذا كان `src` ضمن `node.sources`. الاستثناء المؤقت أثناء `RUNNING`: المصدر الجديد يُشترك فيه فوراً، والمصدر المتروك يُزال في نهاية التشغيل.
- **I-4:** الـ Effect عقدة ورقية، لا مراقِبين لها.
- **I-5:** الـ Computed ليس Owner، ويُمنع أي كتابة إلى Signal أثناء تنفيذ أي Computed.

### 2.3 الخوارزمية المرجعية ✅

الكود الكامل المختبَر في **الملحق B**، واختباراته في **الملحق C**. يُسمح بتحسين التنفيذ (مثل مقارنة المصادر بالفهرس بدل `Set` مؤقت) **بشرط** ألا يتغير أي سلوك ملحوظ في اختبارات §9. المقاطع الحاسمة:

```js
// الوسم الدافع (push) عند الكتابة إلى Signal
function mark(node, next /* CHECK | DIRTY */) {
  const s = node.state;
  if (s === RUNNING) { node.state = next; return; } // ستُعيد finally جدولته
  if (s >= next) return;
  node.state = next;
  if (node.kind === "Effect") { if (s === CLEAN) enqueue(node); }
  else for (const o of [...node.observers]) mark(o, CHECK);
}

// التحقق الكسول (pull) مع break
function validateSources(node) {
  for (const src of node.sources) {            // بترتيب القراءة (I-2)
    if (src.kind === "Computed") updateIfNecessary(src);
    if (node.state === DIRTY) break;           // R-RX-01
  }
}

// بعد إعادة حساب Computed: التأكيد يرقّي CHECK إلى DIRTY فقط
if (changed) for (const o of c.observers) if (o.state === CHECK) o.state = DIRTY; // R-RX-03

// نهاية تشغيل الـ Effect
finally {
  currentObserver = prev; endTracking(e);       // إلغاء اشتراك المصادر المتروكة
  if (e.state === RUNNING) e.state = CLEAN;
  else enqueue(e);                              // وُسِم أثناء التشغيل، فيُعاد في الـ flush نفسه
}
```

### 2.4 قواعد التفاعلية

- **R-RX-01 (Lazy Validation):** الـ `break` في `validateSources` صحيح وإلزامي. **شروط صحته** (يجب تحققها جميعاً):
  1. المصادر مخزنة بترتيب القراءة (I-2).
  2. التأكيد بعد إعادة الحساب يرقّي `CHECK` إلى `DIRTY` فقط (R-RX-03).
  3. إعادة التشغيل تقرأ المصادر المتبقية عبر `read()`، و`read()` يتحقق منها عند القراءة.
- **R-RX-02 (المساواة):** الافتراضي `Object.is`. القيمة `equals: false` تعني «تغيّر دائماً». الخطأ في Computed وزوال الخطأ كلاهما يُعدّ تغييراً.
- **R-RX-03 (التأكيد):** عند تغيّر قيمة Computed، تُرقّى مراقِباته من `CHECK` إلى `DIRTY` فقط. المراقِب في حالة `RUNNING` (أي الذي يقرأه الآن) لا يُلمس، وهذا يمنع إعادة تشغيل زائفة.
- **R-RX-04 (الكتابة داخل Effect) — يحل محل 1-ب في v3.2.1:** الكتابة داخل Effect **مسموحة**. إذا وُسِم Effect وهو في حالة `RUNNING`، تُضبط حالته على `CHECK` أو `DIRTY`، وفي `finally` يُعاد إلى الطابور بدل وضعه `CLEAN`. النتيجة: لا يضيع أي تحديث (T-RX-05..07).
- **R-RX-05 (الاشتراك):** المصدر الجديد يُشترك فيه **فوراً عند أول قراءة**، وليس في نهاية التشغيل. بدون ذلك تضيع الكتابة التي تلي القراءة في التشغيل نفسه (T-RX-06). المصادر المتروكة يُلغى الاشتراك فيها في نهاية التشغيل.
- **R-RX-06 (حد التكرار):** إذا تجاوز Effect واحد عدد `maxEffectRunsPerFlush` من التشغيلات في flush واحد، يُوضع `CLEAN` ولا يُشغَّل مجدداً في هذا الـ flush، ويُوجَّه `MixError("MIX_RT_EFFECT_LOOP")` إلى معالجات أخطائه، ويُكمل الـ flush بقية الطابور. يغطي هذا الحلقة الذاتية والحلقة المتبادلة بين Effectين (T-RX-08، T-RX-09).
- **R-RX-07:** أي كتابة إلى Signal أثناء تنفيذ Computed (حتى داخل `untrack`) ترمي `MIX_RT_WRITE_IN_COMPUTED`.
- **R-RX-08:** قراءة Computed في حالة `RUNNING` ترمي `MIX_RT_CYCLE`.
- **R-RX-09 (تخزين الأخطاء):** إذا رمت دالة Computed خطأً، يُخزَّن ويُعاد رميه عند كل قراءة دون إعادة حساب، حتى يتغير أحد المصادر.
- **R-RX-10:** الـ Effects المُنشأة أثناء تشغيل أو flush تُضاف إلى الطابور، وتعمل في الـ flush نفسه بترتيب إنشائها.
- **R-RX-11 (المجدول):** الكتابة خارج `batch` وخارج flush تجدول flush عبر `config.scheduler`. وتُصدَّر `flushSync()` للاختبارات ومعالجات الأحداث.
- **R-RX-12:** `batch(fn)` قابل للتداخل. يحدث الـ flush عند خروج الـ batch الخارجي فقط، حتى لو رمت `fn`.
- **R-RX-13:** الـ Effect المتخلَّص منه (`DISPOSED`) لا يعمل أبداً، ويُزال من مراقِبات كل مصادره.
- **R-RX-14:** قبل إعادة تشغيل Effect: يُتخلّص من أبنائه بترتيب عكسي، ثم تُنفَّذ `scopeCleanups` بنظام LIFO.

### 2.5 الـ Owner ودورة الحياة

```ts
// packages/runtime/src/core/owner.ts — FROZEN signature
export const createRoot: CreateRoot = (fn, detachedParent) => { /* ... */ };
```

> يُمنع وضع تصريح دالة بلا جسم في ملف `.ts` (الخطأ TS2391 ✅). التصريحات بلا جسم مكانها `declare` داخل ملفات `.d.ts` فقط.

- **R-OW-01:** الـ Root لا يُضاف إلى `children` لأي Owner، ولا يُتخلّص منه مع أي أب. يُتخلّص منه فقط عبر `dispose` الممرَّرة إلى `fn`.
- **R-OW-02:** يحدد `detachedParent` الأب المستخدم **للبحث في السياق وتوجيه الأخطاء فقط**:
  - `undefined`: الـ Owner الحالي.
  - `null`: Root معزول تماماً.
  - Owner محدد: ذلك الـ Owner.
- **R-OW-03 (ترتيب التخلّص):**
  1. `ownerState = DISPOSED`، والعملية idempotent.
  2. الأبناء بترتيب عكسي لإنشائهم.
  3. `scopeCleanups` بنظام LIFO.
  4. الفصل عن `parent.children`.
  5. إن كان Computation: إلغاء الاشتراك في المصادر والإزالة من الطابور.
- **R-OW-04:** تُنفَّذ كل دوال التنظيف حتى لو رمى بعضها. تُجمع الأخطاء: خطأ واحد يُوجَّه كما هو، وأكثر من خطأ يُجمع في `AggregateError`، ثم يُوجَّه إلى معالجات الأب.
- **R-OW-05 (توجيه الأخطاء):** يبدأ من الـ Owner صعوداً عبر `parent`. داخل كل Owner تُستدعى `errorHandlers` بترتيب التسجيل:
  - إعادة `true` تعني «عولج» وتوقف الانتشار.
  - إذا رمى المعالج نفسه، يستمر الانتشار بالخطأ `MIX_RT_ERROR_HANDLER_FAILED` مع `cause` يحمل الخطأ الأصلي.
  - إذا لم يُعالَج الخطأ حتى القمة، يُمرَّر إلى `onUncaughtError`.
- **R-OW-06:** استدعاء `onCleanup` أو `createEffect` خارج أي Owner يطلق في `__DEV__` التحذير `MIX_RT_NO_OWNER`، لأنه خطر تسريب.
- **R-OW-07:** الـ Computed يحفظ الـ `owner` الحالي عند إنشائه، ويسجّل عليه دالة تنظيف تفصله عن مصادره عند التخلّص من ذلك الـ owner.
- **R-OW-08:** إنشاء Effect أو `onCleanup` داخل دالة Computed يرمي `MIX_RT_OWNER_IN_COMPUTED`.
- **R-OW-09:** `createContext<T>(defaultValue: T): Context<T>` تعيد `{ id: symbol, defaultValue }`، و`useContext` يصعد عبر سلسلة `parent`. مفاتيح النص (string) ممنوعة لتجنب التصادم.

---

## 3. الإلغاء (Cancellation) — يحل محل §2-أ في v3.2.1

```ts
// packages/runtime/src/core/cancellation.ts — FROZEN
export interface CancellationToken {
  readonly aborted: boolean;
  readonly reason: unknown;
  subscribe(listener: (reason: unknown) => void): () => void;
  throwIfAborted(): void;
}

export interface CancellationTokenSource {
  readonly token: CancellationToken;
  abort(reason?: unknown): void;
}

export function createCancellationTokenSource(): CancellationTokenSource; // تنفيذ نقي بلا Web APIs
export const neverCancelledToken: CancellationToken;
```

- **R-CX-01:** `abort()` لها أثر مرة واحدة فقط. الاستدعاء الثاني لا يفعل شيئاً، ولا يغيّر `reason`.
- **R-CX-02:** إذا لم يُمرَّر سبب، يكون `reason` الافتراضي `MixError("MIX_RT_ABORTED")`.
- **R-CX-03:** تُستدعى المستمعات بشكل متزامن داخل `abort()`، بترتيب الاشتراك، ومرة واحدة لكل مستمع. تُؤخذ لقطة من القائمة لحظة الإلغاء، لكن المستمع الذي يُلغى اشتراكه قبل دوره لا يُستدعى. بعد ذلك تُفرَّغ القائمة.
- **R-CX-04:** `subscribe` بعد الإلغاء تستدعي المستمع **فوراً وبشكل متزامن** بالسبب، وتعيد دالة إلغاء لا تفعل شيئاً.
- **R-CX-05:** دالة إلغاء الاشتراك idempotent.
- **R-CX-06:** إذا رمى مستمع، تُكمل بقية المستمعات، ثم تُمرَّر الأخطاء إلى `onUncaughtError` بعد انتهاء الإرسال.
- **R-CX-07:** `throwIfAborted()` ترمي `reason` إذا كان الرمز ملغى.
- **R-CX-08 (ComponentScope):** يملك كل ComponentScope الحقل `token`، ويُلغى عند التخلّص منه بالسبب `MIX_RT_DISPOSED`.
- **R-CX-09 (Resource):**
  - كل عملية جلب تحصل على مصدر إلغاء جديد.
  - بدء جلب جديد يلغي السابق بالسبب `MIX_RT_SUPERSEDED`.
  - النتيجة تُطبَّق فقط إذا طابق رقم إصدار الجلب الإصدار الحالي، فالنتائج المتأخرة تُهمل حتى لو تجاهلت دالة الجلب الرمز.
  - التخلّص من الـ owner يلغي الجلب الجاري.

```ts
// packages/runtime/src/platform/abort.ts — FROZEN
export function toAbortSignal(token: CancellationToken): AbortSignal;    // مخزّن لكل token عبر WeakMap؛ وإن كان ملغى: AbortSignal.abort(reason)
export function fromAbortSignal(signal: AbortSignal): CancellationToken;
```

---

## 4. القواعد اللغوية — إضافات إلى `spec/LANGUAGE.md`

### 4.1 حدود التعبيرات (TSExpression) — يحل محل نص v3.2.1 ✅

- **R-SYN-01:** يحدد **المحلل** نهاية التعبير، لا الـ lexer. **يُمنع** عدّ الأقواس أو تخمين نهاية السطر: في الاختبار، أخطأ عدّاد الأقواس في 4 من 8 حالات (نصوص تحتوي `}`، template literals، regex، تعليقات).
- **الخوارزمية:**
  1. عند الوصول إلى بداية تعبير في الموضع `s` (بعد `{` أو `=` أو `(` حسب السياق)، يستدعي المترجم:
     ```js
     const Parser = acorn.Parser.extend(tsPlugin());
     const node = Parser.parseExpressionAt(source, s, {
       ecmaVersion: "latest", sourceType: "module", locations: true,
       preserveParens: true,   // إلزامي ✅
     });
     ```
  2. بعد `node.end`: تُتخطى الفراغات والتعليقات. **يجب** أن يكون المحرف التالي هو الفاصل المتوقع في السياق (مثل `}`). وإلا: `MIX_SYN_EXPR_UNTERMINATED` مع الموضع.
  3. أي استثناء من المحلل يصبح `MIX_SYN_EXPR_INVALID`. المواضع مطلقة داخل ملف `.tix`، فلا تحتاج تحويلاً.
- **R-SYN-01a:** `preserveParens: true` إلزامي. بدونه، في تعبير مثل `{ ({ k: 1 }) }` تقف `node.end` قبل القوس المغلق، فيُرفض تعبير صحيح (✅ ظهر في الاختبار).
- **R-SYN-01b:** شكل الـ AST هو ESTree مع امتدادات TS التي تنتجها `@sveltejs/acorn-typescript`.
- **R-SYN-01c:** السماح بعلامات القالب داخل التعبيرات خارج نطاق v3.2.2. إن وُجدت، تُرفض بـ `MIX_SYN_EXPR_INVALID` ما لم يحدد `LANGUAGE.md` غير ذلك.

### 4.2 العناصر الديناميكية

```ebnf
DynamicElement  = DynamicOpenTag , "/>"
                | DynamicOpenTag , ">" , { Child } , DynamicCloseTag ;
DynamicOpenTag  = "<{~" , TSExpression , "}" , { Attribute } ;
DynamicCloseTag = "</{~" , TSExpression , "}" , ">" ;
(* لا فراغات داخل "<{~" و"</{~" *)
```

- **R-SYN-02:** يُقارن تعبير الإغلاق بتعبير الفتح عبر **تسلسل الـ tokens** (النوع + القيمة)، مع تجاهل الفراغات والتعليقات، وباستخدام tokenizer المحلل نفسه. عند الاختلاف: `MIX_SYN_DYNAMIC_CLOSE_MISMATCH` مع نطاقي الفتح والإغلاق ✅.
- **R-SYN-03:** تعبير الإغلاق **لا يُقيَّم أبداً**، ولا يظهر في الكود المولّد، ولا يُفحص نوعه مستقلاً، تجنباً لتكرار التشخيصات.

---

## 5. TypeScript Projection والأدوات

### 5.1 `@mix/runtime/typecheck` — FROZEN ✅

```ts
// packages/runtime/src/typecheck/index.d.ts — FROZEN (تصريحات فقط)
import type { RefTarget, ComponentFactory } from "@mix/runtime";

export type ComponentTypeContract<T> = T;

/** يتحقق أن العنصر الفعلي يمكن إسناده إلى نوع الـ ref. يُستنتج T من الـ ref وحده. */
export declare function VerifyRef<T>(ref: RefTarget<T>, element: NoInfer<T>): void;
export declare function ElementOf<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
export declare function SvgElementOf<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K];
export declare function AnyElement(): Element;

/** يُستنتج P من المكوّن وحده، فتعمل فحوص الخصائص الزائدة على الـ literal. */
export declare function VerifyProps<P>(comp: ComponentFactory<P, any, any>, props: NoInfer<P>): void;
```

- **R-TC-01:** لكل `ref` على عنصر HTML ثابت يولّد المترجم `VerifyRef(r, ElementOf("input"))`. وفي فضاء SVG يُستخدم `SvgElementOf`. وفي العنصر الديناميكي يُستخدم `AnyElement()`.
- **R-TC-02:** لكل استخدام مكوّن يولّد المترجم `VerifyProps(Comp, { … })`. **يجب** أن يكون الـ object literal مكتوباً داخل الاستدعاء مباشرة (fresh literal) حتى تعمل فحوص الخصائص الزائدة. كل قيمة خاصية مقطع `verbatim` (§5.4)، والـ spread `{...rest}` يُنقل كما هو.
- **R-TC-03:** **يُمنع** حذف `NoInfer`. بدونها، يمرّ الخطأ الإملائي `{ label: "x", lable: "y" }` بلا أي تشخيص (✅ ثبت في الاختبار).

### 5.2 الـ Resolver ومسارات `.tix`

- **R-RS-01:** الاستيراد في الكود المصدري يكون بامتداد صريح: `import Button from "./Button.tix"`. الاستيراد بلا امتداد لملف `.tix` يرمي `MIX_RES_TIX_EXTENSION_REQUIRED`.
- **R-RS-02 (فحص الأنواع):** `X.tix` يُوجَّه إلى وحدة افتراضية `X.tix.ts` هي الـ projection.
- **R-RS-03 (البناء):** كل `X.tix` يُترجم إلى `X.tix.js` و`X.tix.js.map`، ومعهما `X.tix.d.ts` للمكتبات. ويُعاد كتابة كل استيراد من `./Button.tix` إلى `./Button.tix.js`. **يُمنع** إنتاج استيراد بلا امتداد، لأنه يكسر ESM الأصلي في Node والمتصفح.
- **R-RS-04:** القاعدة نفسها تنطبق على مسارات الحزم (`pkg/Button.tix` → `pkg/Button.tix.js`). ويجب أن تكشف `exports` في الحزم المنشورة ملفات `.tix.js`.
- **R-RS-05:** مع الإخراج السابق، يجد TypeScript ملف `Button.tix.d.ts` تلقائياً عند الاستيراد `./Button.tix.js`، دون أي إعداد إضافي.

### 5.3 سلسلة الأدوات وإصدارات TypeScript (جديد)

- صدر TypeScript 7.0 (المترجم الأصلي بلغة Go) في يوليو 2026 **بلا واجهة برمجية (programmatic API)**. الواجهة الجديدة مخططة لـ 7.1، التي صدرت نسختها التجريبية في أكتوبر 2026. لهذا ما زالت أدوات مثل `vue-tsc` و`svelte-check`، المبنية على Volar، تعمل على واجهة TS 6.
- **R-TL-01:** تُبنى `@mix/tsc` وإضافة المحرر على **واجهة TS 6**:
  ```jsonc
  // package.json (devDependencies)
  "typescript": "npm:@typescript/typescript6",     // للأدوات التي تستورد typescript كمكتبة
  "@typescript/native": "npm:typescript@^7.0.2"    // tsc السريع لحزم .ts العادية
  ```
- **R-TL-02:** الحزم المكتوبة بـ `.ts` فقط (core وsecurity وdom وplatform) تُفحص وتُبنى بـ `tsc` من TS 7. وملفات `.tix` تُفحص بـ `@mix/tsc`.
- **R-TL-03 (المحرر):** في محرر مبني على VS Code، تُحمَّل إضافة TS language service على نمط Volar (`createLanguageServicePlugin`). ويُضبط `"typescript.tsdk": "node_modules/typescript/lib"`، وهي TS 6 عبر الـ alias.
- **R-TL-04:** بند ترحيل مستقبلي: عند استقرار واجهة TS 7.1، يُعاد تقييم الانتقال إليها. هذا خارج نطاق v3.2.2.

### 5.4 جدول المقاطع (SourceMapSpanTable) — يحل محل «أقرب سطر وعمود»

```ts
// packages/compiler/src/projection/spans.ts — FROZEN
export type SpanKind = "verbatim" | "origin" | "internal";
export interface SpanEntry {
  readonly genStart: number; readonly genEnd: number;   // مواضع في ملف الـ projection
  readonly srcStart: number; readonly srcEnd: number;   // مواضع في ملف .tix (تُتجاهل في internal)
  readonly kind: SpanKind;
}
```

- **R-SP-01 (`verbatim`):** كود المستخدم المنسوخ حرفياً، بالطول نفسه في الطرفين. الربط دقيق على مستوى المحرف.
- **R-SP-02 (`origin`):** كود مولّد بسبب بنية في `.tix` (وسم، خاصية، توجيه). يُربط بنطاق تلك البنية كاملاً.
- **R-SP-03 (`internal`):** كود بلا أصل لدى المستخدم (دوال مساعدة، استيرادات، أغلفة).
- **R-SP-04 (ربط التشخيص):** يُختار أصغر مقطع يحتوي بداية التشخيص:
  - `verbatim`: الموضع الدقيق.
  - `origin`: نطاق البنية.
  - `internal`: **يُمنع** إظهار التشخيص في موضع المستخدم. يُصدر بدلاً منه `MIX_INTERNAL_TYPECHECK` مع مقتطف من الـ projection ونسخة المترجم، لأنه خطأ في المترجم لا في كود المستخدم.
- **R-SP-05:** كل بايت في الـ projection يغطيه مقطع داخلي واحد بالضبط، ويتحقق اختبار من هذه التغطية.

---

## 6. الأمن

### 6.1 سياسة الروابط ✅

```ts
// packages/runtime/src/security/url.ts — FROZEN
export type UrlContext = "navigation" | "media" | "resource";
export function isAllowedUrl(raw: string, context: UrlContext): boolean;
```

- **R-URL-01 (التوقيت):** القيمة الثابتة تُفحص وقت الترجمة وتُرفض بـ `MIX_SEC_UNSAFE_URL`. القيمة الديناميكية تُفحص وقت التشغيل:
  - في `__DEV__`: يُرمى `MixError`.
  - في الإنتاج: لا تُضبط الخاصية (أو تُزال) ويُستدعى `onSecurityViolation`.

### 6.2 srcset — مطابق لـ WHATWG ✅

- **R-SRCSET-01:** **يجب** تنفيذ خوارزمية «parse a srcset attribute» من HTML Standard حرفياً:
  https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
- **R-SRCSET-02:** كل رابط يُمرَّر إلى `isAllowedUrl(url, "media")`. رفض رابط واحد يعني **رفض الخاصية كاملة**، ويُمنع تصفيتها جزئياً.
- **R-SRCSET-03:** يُطبَّق على `img[srcset]` و`source[srcset]` و`link[imagesrcset]`، وقت الترجمة للقيم الثابتة ووقت التشغيل للقيم الديناميكية.

### 6.3 الأنماط الديناميكية — يحل محل §5-ب في v3.2.1 ✅

- **R-CSS-01 (التطبيق):** في المتصفح، **يجب** تطبيق كل خاصية عبر `el.style.setProperty(name, value)` منفردة. **يُمنع** تجميع `cssText` أو كتابة خاصية `style` كنص.
- **R-CSS-02 (أسماء الخصائص):** الأسماء الثابتة تأتي من الترجمة. المفاتيح الديناميكية، بعد تحويل camelCase إلى kebab-case، يجب أن تطابق `^--[A-Za-z0-9_-]+$` أو `^-?[a-z][a-z0-9-]*$`. وإلا: `MIX_SEC_INVALID_STYLE_PROPERTY`.
- **R-CSS-03 (فحص القيم)** عبر `@csstools/css-tokenizer`.
- **R-CSS-04 (المسار السريع):** إذا لم تحتوِ القيمة أياً من المحارف `( ; { } " ' \` ولا السلسلة `/*`، تُقبل دون تقطيع.
- **R-CSS-05 (التوقيت):** القيم الثابتة تُرفض وقت الترجمة بـ `MIX_SEC_INSECURE_STATIC_STYLE`، والقيم الديناميكية تُفحص وقت التشغيل.
- **R-CSS-06 (SSR):** عند توليد `style="…"` نصياً، تُطبَّق R-CSS-03 نفسها.

### 6.4 HTML الموثوق — يحل محل §5-ج في v3.2.1

```ts
// packages/runtime/src/security/trusted-html.ts — FROZEN
export type HtmlSanitizerFn = (dirtyHtml: string) => string;
export interface TrustedHtmlValue { readonly html: string; }
export function createTrustedHtml(dirtyHtml: string, sanitizer: HtmlSanitizerFn): TrustedHtmlValue;
export function isTrustedHtml(value: unknown): value is TrustedHtmlValue;
```

- **R-HTML-01:** التحقق يتم عبر `WeakSet<object>` خاص بالوحدة، وتُضاف إليه كل قيمة يُنشئها `createTrustedHtml`.
- **R-HTML-02:** إذا لم تكن `sanitizer` دالة: `MIX_SEC_MISSING_SANITIZER`.
- **R-HTML-03 (الصدق في التوثيق):** الـ API لا يضمن فعالية دالة التنقية. في `__DEV__` يُفحص بـ canary payload، وعند وجود `onerror` أو `<script` أو `javascript:` يصدر تحذير `MIX_SEC_SANITIZER_SUSPICIOUS`.
- **R-HTML-04 (سياق الإدراج):** يُسمح بإدراج `TrustedHtmlValue` فقط داخل عناصر من فضاء HTML، وليست من القائمة الممنوعة.
- **R-HTML-05 (Trusted Types):** استخدام `globalThis.trustedTypes?.createPolicy` إذا وُجدت.
- **R-HTML-06:** في `__DEV__`، إذا كان الكائن مجمَّداً وفيه `html` نصي لكنه خارج السجل، يُرمى `MIX_SEC_FOREIGN_TRUSTED_HTML`.

---

## 7. القوائم بمفاتيح — سياسة المفاتيح المكررة

- **R-KEY-01:** مقارنة المفاتيح بـ SameValueZero (دلالات `Map`).
- **R-KEY-02 (`__DEV__`):** المفتاح المكرر يرمي `MIX_RT_DUPLICATE_KEY` مع التفاصيل `{ key, firstIndex, duplicateIndex }`.
- **R-KEY-03 (الإنتاج):** يُمنع حذف أي عنصر. التكرار رقم n للمفتاح k يأخذ هوية داخلية `(k, n)`، ويُعرض كل العناصر مع تحذير `onWarning`.

---

## 8. HMR — (التطوير فقط)

- **R-HMR-01 (الترجمة في وضع التطوير):** روابط المستوى الأعلى تُرفع إلى كائن `scope` لكل نسخة.
- **R-HMR-02 (Trampolines):** أي مرجع إلى دالة محلية يمر عبر trampoline ثابت الهوية `instance.trampoline("name")`.
- **R-HMR-03 (التوقيع):** `hmrSignature`.
- **R-HMR-04 (تطبيق التحديث):** توقيع مطابق: تحديث الدوال وإعادة عرض القالب على الـ scope الحي؛ توقيع مختلف: remount كامل.
- **R-HMR-05:** في الإنتاج لا وجود لـ trampolines أو scope hoisting.

```ts
// packages/runtime/src/hmr/types.ts — FROZEN
export interface HmrComponentRecord {
  readonly id: string;
  readonly signature: string;
  readonly methods: (scope: Record<string, unknown>) => Record<string, (...args: never[]) => unknown>;
  readonly render: (scope: Record<string, unknown>) => unknown;
}
export function applyHmrUpdate(next: HmrComponentRecord): void;
```

---

## 9. اختبارات المطابقة — ملخص

- **T-RX-01..17:** التفاعلية.
- **T-OW-01..05:** الـ Owner ودورة الحياة.
- **T-CX-01..06:** الإلغاء و`toAbortSignal` / `fromAbortSignal`.
- **T-SYN-01..12:** حدود التعبيرات والعناصر الديناميكية.
- **T-TC-01..07:** فحص الأنواع مع `NoInfer`.
- **T-RS-01..02:** مسارات الاستيراد الصريحة `.tix.js`.
- **T-SP-01..03:** جدول المقاطع وتغطية الـ projection.
- **T-URL-01..06:** سياسة الروابط عبر WHATWG URL.
- **T-SRCSET-01..06:** خوارزمية WHATWG srcset.
- **T-CSS-01..12:** فحص الـ CSS tokenizer.
- **T-HTML-01..04:** HTML الموثوق وWeakSet.
- **T-KEY-01..03:** المفاتيح المكررة في التطوير والإنتاج.
- **T-HMR-01..03:** trampolines وحفظ الحالة.

---

## 10. سجل رموز الأخطاء

انظر الجدول في §10 من المواصفة.

---

## 11. مراحل التنفيذ للوكيل

| المرحلة | النطاق | تعريف الإنجاز (DoD) |
|---|---|---|
| **0. التهيئة** | `tsconfig.base.json`، وقواعد lint (`no-restricted-globals` في core: `window` و`document` و`navigator` و`AbortController` و`AbortSignal` و`URL` و`setTimeout` و`queueMicrotask` و`process`، ومنع `enum`)، وتعريف `__DEV__`، و vitest | البناء والـ lint ينجحان على مستودع فارغ |
| **1. التفاعلية** | §2.1–2.4 | T-RX-01..17 |
| **2. الـ Owner والإلغاء** | §2.5، §3 | T-OW-*، T-CX-* |
| **3. وحدة الأمن** | §6.1–6.3 + `createTrustedHtml` (دوال نقية) | T-URL-*، T-SRCSET-*، T-CSS-*، T-HTML-01..03 |
| **4. المحلل** | §4 | T-SYN-* |
| **5. الـ Projection والأدوات** | §5 | T-TC-*، T-RS-*، T-SP-* |
| **6. الـ DOM runtime** | تطبيق الروابط والأنماط (R-CSS-01)، الإدراج وTrusted Types (R-HTML-04/05)، المفاتيح (§7) | T-HTML-04، T-KEY-* |
| **7. HMR** | §8 | T-HMR-* |

---

## الملحق B — النموذج المرجعي للنواة التفاعلية (مُختبَر)
(انظر نص المواصفة)

## الملحق C — اختبارات النموذج المرجعي (12/12 ناجحة)
(انظر نص المواصفة)

