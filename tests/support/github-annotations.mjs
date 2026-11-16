/**
 * node:test reporter that turns each failed test into a GitHub Actions error annotation
 * (`::error file=…,line=…::message`). Annotations are listed on the run page and through the
 * public checks API, so a failure can be read without opening the job log.
 * Used next to the normal `spec` reporter by `npm run test:ci`.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE_LENGTH = 900;

/** Escapes text the way the workflow command syntax requires. */
function escapeData(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function toRepositoryPath(file) {
  if (!file) return "";
  const absolute = file.startsWith("file:") ? fileURLToPath(file) : file;
  return path.relative(process.cwd(), absolute).split(path.sep).join("/");
}

function describeError(error) {
  const cause = error?.cause ?? error;
  const message = cause instanceof Error ? cause.message : String(cause ?? "test failed");
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
}

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== "test:fail") continue;
    const { name, file, line, details, todo, skip } = event.data;
    if (todo || skip) continue;
    const failureType = details?.error?.failureType;
    if (failureType === "subtestsFailed") continue;
    const location = file ? `file=${escapeProperty(toRepositoryPath(file))}${line ? `,line=${line}` : ""},` : "";
    yield `::error ${location}title=${escapeProperty(name)}::${escapeData(describeError(details?.error))}\n`;
  }
}
