# @dotmix/image

Optional responsive image component (`<Picture>`) and build-time AVIF/WebP optimizer for dotMix.

Part of [dotMix](https://github.com/chemseddine201/dotMix), a compiler-native web framework with no virtual DOM.

## Install

```bash
npm install @dotmix/image
# Optional build-time AVIF/WebP image optimization:
npm install --save-dev sharp
```

`<Picture>` supports intrinsic `width`/`height`, safe `srcset`, `loading`/`decoding`/`fetchpriority`, and zero-network `placeholder` mode without requiring `sharp`. `@dotmix/runtime` remains at zero external dependencies.

See the [main README](https://github.com/chemseddine201/dotMix#readme) for documentation.

## License

MIT

