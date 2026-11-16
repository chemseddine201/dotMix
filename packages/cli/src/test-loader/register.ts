/**
 * Preloaded by `mix test` (`node --import …/register.js --test …`): installs the hooks that let
 * project tests import TypeScript modules. Node passes `--import` on to every test file process.
 */

import { register } from "node:module";

register("./hooks.js", import.meta.url);
