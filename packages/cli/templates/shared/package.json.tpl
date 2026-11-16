{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "mix dev",
    "build": "mix build src dist",
    "check": "mix check src",
    "test": "mix test"
  },
  "dependencies": {
    "@dotmix/runtime": "{{dotmixVersion}}",
    "@dotmix/router": "{{dotmixVersion}}",
    "@dotmix/sync": "{{dotmixVersion}}",
    "@dotmix/helpers": "{{dotmixVersion}}"
  },
  "devDependencies": {
    "@dotmix/cli": "{{dotmixVersion}}"
  }
}

