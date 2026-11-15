import { createContext } from "@dotmix/runtime";

// Defaults to null so a reader outside any provider can detect the missing value.
export const ThemeContext = createContext<string | null>(null);
