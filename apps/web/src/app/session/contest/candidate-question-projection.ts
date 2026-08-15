const CONTRACT = "ams.candidate-question-projection";
const SCHEMA_VERSION = 1;
const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;
const MAX_STARTER_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ASSETS = 64;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_FIELDS = new Set([
  "archive_sha256",
  "checker",
  "manifest_json",
  "solution",
  "storage_bucket",
  "storage_generation",
  "storage_object",
  "validated_manifest",
]);

type RecordValue = Record<string, unknown>;

export type ProjectionAsset = {
  id: string;
  path: string;
  filename: string;
  media_type: string;
  sha256: string;
  size_bytes: number;
  url: string;
  object_url: string;
};

export type CXXProbeQuestionProjection = {
  bundle_sha256: string;
  projection_sha256: string;
  problem_name: string;
  language: "cpp";
  standard: "c++23";
  limits: {
    memory_bytes: number;
    cpu_time_ms: number;
    wall_time_ms: number;
    max_pids: number;
  };
  statement: {
    path: string;
    sha256: string;
    size_bytes: number;
    content: string;
  };
  starter: null | {
    path: string;
    filename: string;
    language: "cpp";
    sha256: string;
    size_bytes: number;
    content: string;
  };
  assets: ProjectionAsset[];
};

export type CandidateQuestion = {
  id: string;
  title: string;
  description: string | null;
  starter_code: string | null;
  starter_filename: string | null;
  order_index: number;
  question_type: string;
  points: number;
  judge_engine: "legacy" | "cxxprobe";
  time_limit_ms: number | null;
  memory_limit_mb: number | null;
  cxxprobe: CXXProbeQuestionProjection | null;

  // Contract v2. Worked examples the candidate checks their own output
  // against, and the marking scheme — including the symbolic rules, which are
  // a *gate*: one violation zeroes this problem's partial credit however well
  // the code runs. Being marked against an instruction you were never shown
  // is the failure these two fields exist to prevent.
  samples?: { label?: string; input: string; output: string }[];
  families?: import("@/lib/proctor-api").ProblemFamilies;
  /** The projection was reconstructed from the pre-v2 columns, so the marking
   * scheme is unknown rather than empty — a distinction that matters, because
   * saying "no restrictions" when we cannot tell is the unfair direction. */
  backfilled?: boolean;
};

export type LoadedCandidateQuestions = {
  questions: CandidateQuestion[];
  objectUrls: string[];
};

export type LoadCandidateQuestionsOptions = {
  expectedSessionId: string;
  apiBase: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  createObjectURL?: (blob: Blob) => string;
  signal?: AbortSignal;
};

export class CandidateQuestionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateQuestionContractError";
  }
}

function fail(message: string): never {
  throw new CandidateQuestionContractError(message);
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): RecordValue {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
}

function string(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    fail(`${field} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${field} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function digest(value: unknown, field: string): string {
  const result = string(value, field);
  if (!SHA256.test(result)) fail(`${field} must be lowercase SHA-256`);
  return result;
}

function uuid(value: unknown, field: string): string {
  const result = string(value, field);
  if (!UUID.test(result)) fail(`${field} must be a UUID`);
  return result;
}

function rejectPrivateFields(value: unknown, path = "response"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPrivateFields(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_FIELDS.has(key)) fail(`${path}.${key} is private judge material`);
    rejectPrivateFields(child, `${path}.${key}`);
  }
}

function projectionPath(value: unknown, field: string): string {
  const result = string(value, field);
  if (
    result.length > 512 ||
    result.startsWith("/") ||
    result.includes("\\") ||
    /[\u0000-\u001f\u007f-\u009f]/.test(result)
  ) {
    fail(`${field} is not a safe relative path`);
  }
  const components = result.split("/");
  if (components.some((part) => part === "" || part === "." || part === "..")) {
    fail(`${field} is not normalized`);
  }
  return result;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function looksLikeCpp(value: string): boolean {
  return /#include\s*<|using\s+namespace\s+std|int\s+main\s*\(/.test(value);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("Web Crypto SHA-256 is unavailable");
  const input = Uint8Array.from(bytes).buffer;
  const result = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyText(
  value: RecordValue,
  field: string,
  maximum: number
): Promise<{ path: string; sha256: string; size_bytes: number; content: string }> {
  const path = projectionPath(value.path, `${field}.path`);
  const expectedDigest = digest(value.sha256, `${field}.sha256`);
  const size = integer(value.size_bytes, `${field}.size_bytes`, 1);
  if (size > maximum) fail(`${field}.size_bytes exceeds its public bound`);
  const content = string(value.content, `${field}.content`);
  const bytes = utf8(content);
  if (bytes.byteLength !== size) fail(`${field}.content byte length does not match`);
  if ((await sha256Hex(bytes)) !== expectedDigest) fail(`${field}.content SHA-256 does not match`);
  return { path, sha256: expectedDigest, size_bytes: size, content };
}

function goCanonicalJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const code = character.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

function expectedAssetURL(sessionId: string, questionId: string, assetId: string): string {
  return `/sessions/${sessionId}/questions/${questionId}/assets/${assetId}`;
}

function verifyAssetMagic(bytes: Uint8Array, mediaType: ProjectionAsset["media_type"]): boolean {
  if (mediaType === "image/png") {
    return (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value
      )
    );
  }
  if (mediaType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
  );
}

function mediaTypeFor(value: unknown, path: string, field: string): ProjectionAsset["media_type"] {
  if (value !== "image/png" && value !== "image/jpeg" && value !== "image/webp") {
    fail(`${field}.media_type is unsupported`);
  }
  const lower = path.toLowerCase();
  const matches =
    (value === "image/png" && lower.endsWith(".png")) ||
    (value === "image/jpeg" && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) ||
    (value === "image/webp" && lower.endsWith(".webp"));
  if (!matches) fail(`${field}.media_type does not match its path`);
  return value;
}

async function fetchAsset(
  asset: Omit<ProjectionAsset, "object_url">,
  options: LoadCandidateQuestionsOptions
): Promise<ProjectionAsset> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createObjectURL = options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10_000);
  try {
    const response = await fetchImpl(`${options.apiBase}${asset.url}`, {
      method: "GET",
      headers: options.headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) fail(`asset ${asset.id} returned HTTP ${response.status}`);
    const contentType = (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim();
    if (contentType !== asset.media_type) fail(`asset ${asset.id} media type does not match`);
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null && Number(contentLength) !== asset.size_bytes) {
      fail(`asset ${asset.id} content length does not match`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== asset.size_bytes) fail(`asset ${asset.id} byte length does not match`);
    if (!verifyAssetMagic(bytes, asset.media_type))
      fail(`asset ${asset.id} signature does not match`);
    if ((await sha256Hex(bytes)) !== asset.sha256) fail(`asset ${asset.id} SHA-256 does not match`);
    return {
      ...asset,
      object_url: createObjectURL(new Blob([bytes], { type: asset.media_type })),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function parseLegacyQuestion(common: RecordValue, legacyValue: unknown): CandidateQuestion {
  const legacy = record(legacyValue, `questions[${common.id}].legacy`);
  const htmlStarter = string(legacy.html_starter, "legacy.html_starter", true);
  string(legacy.css_starter, "legacy.css_starter", true);
  string(legacy.js_starter, "legacy.js_starter", true);
  return {
    id: common.id as string,
    title: common.title as string,
    description: string(legacy.description, "legacy.description", true),
    starter_code: looksLikeCpp(htmlStarter) ? htmlStarter : null,
    starter_filename: null,
    order_index: common.order_index as number,
    question_type: common.type as string,
    points: common.points as number,
    judge_engine: "legacy",
    time_limit_ms: integer(legacy.time_limit_ms, "legacy.time_limit_ms", 0),
    memory_limit_mb: integer(legacy.memory_limit_mb, "legacy.memory_limit_mb", 0),
    cxxprobe: null,
  };
}

async function parseCXXProbeQuestion(
  common: RecordValue,
  cxxValue: unknown,
  options: LoadCandidateQuestionsOptions
): Promise<CandidateQuestion> {
  const field = `questions[${common.id}].cxxprobe`;
  const cxx = record(cxxValue, field);
  const bundleSHA256 = digest(cxx.bundle_sha256, `${field}.bundle_sha256`);
  const projectionSHA256 = digest(cxx.projection_sha256, `${field}.projection_sha256`);
  const problemName = string(cxx.problem_name, `${field}.problem_name`);
  if (cxx.language !== "cpp") fail(`${field}.language must be cpp`);
  if (cxx.standard !== "c++23") fail(`${field}.standard must be c++23`);
  if (common.type !== "code") fail(`${field} must belong to a code question`);

  const limitsValue = record(cxx.limits, `${field}.limits`);
  const limits = {
    memory_bytes: integer(limitsValue.memory_bytes, `${field}.limits.memory_bytes`, 1),
    cpu_time_ms: integer(limitsValue.cpu_time_ms, `${field}.limits.cpu_time_ms`, 1),
    wall_time_ms: integer(limitsValue.wall_time_ms, `${field}.limits.wall_time_ms`, 1),
    max_pids: integer(limitsValue.max_pids, `${field}.limits.max_pids`, 1),
  };
  const statement = await verifyText(
    record(cxx.statement, `${field}.statement`),
    `${field}.statement`,
    MAX_STATEMENT_BYTES
  );
  const root = statement.path.split("/", 1)[0];

  let starter: CXXProbeQuestionProjection["starter"] = null;
  if (cxx.starter !== null) {
    const starterValue = record(cxx.starter, `${field}.starter`);
    const verified = await verifyText(starterValue, `${field}.starter`, MAX_STARTER_BYTES);
    const filename = string(starterValue.filename, `${field}.starter.filename`);
    if (starterValue.language !== "cpp") fail(`${field}.starter.language must be cpp`);
    if (
      verified.path.split("/", 1)[0] !== root ||
      verified.path.split("/")[1] !== "public" ||
      filename !== basename(verified.path) ||
      !filename.endsWith(".cpp")
    ) {
      fail(`${field}.starter filename/path is invalid`);
    }
    starter = { ...verified, filename, language: "cpp" };
  }

  if (!Array.isArray(cxx.assets) || cxx.assets.length > MAX_ASSETS) {
    fail(`${field}.assets exceeds its public count bound`);
  }
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  const assetMetadata = cxx.assets.map((value, index) => {
    const assetField = `${field}.assets[${index}]`;
    const asset = record(value, assetField);
    const id = uuid(asset.id, `${assetField}.id`);
    const path = projectionPath(asset.path, `${assetField}.path`);
    const filename = string(asset.filename, `${assetField}.filename`);
    if (path.split("/", 1)[0] !== root || path.split("/")[1] !== "public") {
      fail(`${assetField}.path is outside the problem public directory`);
    }
    if (filename !== basename(path)) fail(`${assetField}.filename does not match its path`);
    const lowerPath = path.toLowerCase();
    if (assetIds.has(id) || assetPaths.has(lowerPath)) fail(`${assetField} is duplicated`);
    assetIds.add(id);
    assetPaths.add(lowerPath);
    const size = integer(asset.size_bytes, `${assetField}.size_bytes`, 1);
    if (size > MAX_ASSET_BYTES) fail(`${assetField}.size_bytes exceeds its public bound`);
    const url = string(asset.url, `${assetField}.url`);
    const expectedURL = expectedAssetURL(options.expectedSessionId, common.id as string, id);
    if (url !== expectedURL) fail(`${assetField}.url is not bound to this session question`);
    return {
      id,
      path,
      filename,
      media_type: mediaTypeFor(asset.media_type, path, assetField),
      sha256: digest(asset.sha256, `${assetField}.sha256`),
      size_bytes: size,
      url,
    };
  });

  const totalBytes =
    statement.size_bytes +
    (starter?.size_bytes ?? 0) +
    assetMetadata.reduce((total, asset) => total + asset.size_bytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES) fail(`${field} exceeds its total public byte bound`);

  const digestDocument = {
    contract: CONTRACT,
    schema_version: SCHEMA_VERSION,
    bundle_sha256: bundleSHA256,
    problem_name: problemName,
    language: "cpp",
    standard: "c++23",
    limits,
    statement: {
      path: statement.path,
      sha256: statement.sha256,
      size_bytes: statement.size_bytes,
    },
    starter: starter
      ? {
          path: starter.path,
          language: starter.language,
          sha256: starter.sha256,
          size_bytes: starter.size_bytes,
        }
      : null,
    assets: assetMetadata.map((asset) => ({
      path: asset.path,
      media_type: asset.media_type,
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
    })),
  };
  if ((await sha256Hex(utf8(goCanonicalJSON(digestDocument)))) !== projectionSHA256) {
    fail(`${field}.projection_sha256 does not match its public metadata`);
  }

  const settled = await Promise.allSettled(
    assetMetadata.map((asset) => fetchAsset(asset, options))
  );
  const loadedAssets = settled
    .filter(
      (result): result is PromiseFulfilledResult<ProjectionAsset> => result.status === "fulfilled"
    )
    .map((result) => result.value);
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failed) {
    loadedAssets.forEach((asset) => URL.revokeObjectURL(asset.object_url));
    throw failed.reason;
  }

  return {
    id: common.id as string,
    title: common.title as string,
    description: statement.content,
    starter_code: starter?.content ?? null,
    starter_filename: starter?.filename ?? null,
    order_index: common.order_index as number,
    question_type: common.type as string,
    points: common.points as number,
    judge_engine: "cxxprobe",
    time_limit_ms: limits.wall_time_ms,
    memory_limit_mb: Math.ceil(limits.memory_bytes / (1024 * 1024)),
    cxxprobe: {
      bundle_sha256: bundleSHA256,
      projection_sha256: projectionSHA256,
      problem_name: problemName,
      language: "cpp",
      standard: "c++23",
      limits,
      statement,
      starter,
      assets: loadedAssets,
    },
  };
}

export async function loadCandidateQuestions(
  payload: unknown,
  options: LoadCandidateQuestionsOptions
): Promise<LoadedCandidateQuestions> {
  rejectPrivateFields(payload);
  const response = record(payload, "response");
  if (response.contract !== CONTRACT) fail(`response.contract must be ${CONTRACT}`);
  if (response.schema_version !== SCHEMA_VERSION) fail("response.schema_version is unsupported");
  const expectedSessionId = uuid(options.expectedSessionId, "expectedSessionId");
  if (response.session_id !== expectedSessionId)
    fail("response.session_id does not match the session");
  if (!Array.isArray(response.questions)) fail("response.questions must be an array");

  const ids = new Set<string>();
  const orderIndexes = new Set<number>();
  const questions: CandidateQuestion[] = [];
  try {
    for (let index = 0; index < response.questions.length; index += 1) {
      const value = record(response.questions[index], `questions[${index}]`);
      const id = uuid(value.id, `questions[${index}].id`);
      const orderIndex = integer(value.order_index, `questions[${index}].order_index`, 0);
      if (ids.has(id) || orderIndexes.has(orderIndex))
        fail(`questions[${index}] has duplicate identity/order`);
      ids.add(id);
      orderIndexes.add(orderIndex);
      const common: RecordValue = {
        id,
        order_index: orderIndex,
        title: string(value.title, `questions[${index}].title`, true),
        points: integer(value.points, `questions[${index}].points`, 0),
        type: string(value.type, `questions[${index}].type`),
      };
      const hasLegacy = Object.hasOwn(value, "legacy");
      const hasCXXProbe = Object.hasOwn(value, "cxxprobe");
      if (hasLegacy === hasCXXProbe)
        fail(`questions[${index}] must have exactly one public branch`);
      if (value.judge_engine === "legacy" && hasLegacy) {
        questions.push(parseLegacyQuestion(common, value.legacy));
      } else if (value.judge_engine === "cxxprobe" && hasCXXProbe) {
        questions.push(await parseCXXProbeQuestion(common, value.cxxprobe, options));
      } else {
        fail(`questions[${index}].judge_engine does not match its public branch`);
      }
    }
  } catch (error) {
    questions
      .flatMap((question) => question.cxxprobe?.assets ?? [])
      .forEach((asset) => URL.revokeObjectURL(asset.object_url));
    throw error;
  }
  questions.sort((left, right) => left.order_index - right.order_index);
  return {
    questions,
    objectUrls: questions.flatMap((question) =>
      (question.cxxprobe?.assets ?? []).map((asset) => asset.object_url)
    ),
  };
}

export function resolveCandidateAssetURL(
  source: string,
  statementPath: string,
  assets: ReadonlyArray<{ path: string; object_url: string }>
): string | null {
  if (
    source.length === 0 ||
    source.startsWith("/") ||
    source.includes("\\") ||
    source.includes("?") ||
    source.includes("#") ||
    source.includes("%") ||
    /^[a-z][a-z0-9+.-]*:/i.test(source) ||
    /[\u0000-\u001f\u007f-\u009f]/.test(source)
  ) {
    return null;
  }
  const statementParts = statementPath.split("/");
  statementParts.pop();
  const sourceParts = source.split("/");
  const resolved = [...statementParts];
  for (const part of sourceParts) {
    if (part === "" || part === "..") return null;
    if (part !== ".") resolved.push(part);
  }
  const exactPath = resolved.join("/");
  return assets.find((asset) => asset.path === exactPath)?.object_url ?? null;
}

export function releaseCandidateQuestionAssets(objectUrls: readonly string[]): void {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
}
