{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "mix dev",
    "build": "mix build src dist",
    "check": "mix check src",
    "test": "node --test tests/**/*.test.mjs"
  },
  "dependencies": {
    "@mix/runtime": "0.1.0",
    "@mix/router": "0.1.0",
    "@mix/sync": "0.1.0",
    "mix-helpers": "0.1.0"
  }
}

