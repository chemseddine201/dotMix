/**
 * mix-helpers/data — dotMix Pure Data & Function Utilities (`dot` namespace)
 *
 * 100% zero external dependencies. Prototype-pollution protected.
 */

import { toPath, get, set, unset, has, pick, omit } from "./path.js";
import { isPlainObject, merge, defaults, defaultsDeep, cloneDeep, isEqual } from "./object.js";
import {
  chunk,
  compact,
  uniq,
  uniqBy,
  flatten,
  flattenDeep,
  groupBy,
  keyBy,
  countBy,
  orderBy,
  sortBy,
  partition,
  difference,
  intersection,
  zip,
} from "./collection.js";
import {
  words,
  camelCase,
  kebabCase,
  snakeCase,
  pascalCase,
  capitalize,
  deburr,
  slugify,
  truncate,
  escapeHtml,
  unescapeHtml,
} from "./string.js";
import { debounce, throttle, once, memoize, curry, pipe, compose } from "./function.js";
import {
  isEmpty,
  isNil,
  isNumber,
  isString,
  isBoolean,
  isFunction,
  isDate,
  isRegExp,
  clamp,
  sumBy,
  meanBy,
  minBy,
  maxBy,
  range,
  randomInt,
} from "./predicates-math.js";

export * from "./path.js";
export * from "./object.js";
export * from "./collection.js";
export * from "./string.js";
export * from "./function.js";
export * from "./predicates-math.js";

export const dot = {
  toPath,
  get,
  set,
  unset,
  has,
  pick,
  omit,
  merge,
  defaults,
  defaultsDeep,
  cloneDeep,
  isEqual,
  isEmpty,
  isPlainObject,
  isNil,
  isNumber,
  isString,
  isBoolean,
  isFunction,
  isDate,
  isRegExp,
  clamp,
  sumBy,
  meanBy,
  minBy,
  maxBy,
  range,
  randomInt,
  chunk,
  compact,
  uniq,
  uniqBy,
  flatten,
  flattenDeep,
  groupBy,
  keyBy,
  countBy,
  orderBy,
  sortBy,
  partition,
  difference,
  intersection,
  zip,
  words,
  camelCase,
  kebabCase,
  snakeCase,
  pascalCase,
  capitalize,
  deburr,
  slugify,
  truncate,
  escapeHtml,
  unescapeHtml,
  debounce,
  throttle,
  once,
  memoize,
  curry,
  pipe,
  compose,
};
