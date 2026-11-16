# @dotmix/sanitizer-dompurify

HTML sanitizer adapter for dotMix built on DOMPurify.

Part of [dotMix](https://github.com/chemseddine201/dotMix), a compiler-native web framework with no virtual DOM.

## Install

```bash
npm install @dotmix/sanitizer-dompurify
```

`createDomPurifySanitizer()` returns a `SanitizerProvider` for `setSanitizerProvider()`. It delegates to DOMPurify when you pass an instance (`{ dompurify }`) or load it as `globalThis.DOMPurify`; without it, it uses its own DOM allowlist sanitizer. `dompurify` is an optional peer dependency.

See the [main README](https://github.com/chemseddine201/dotMix#readme) for documentation.

## License

MIT
