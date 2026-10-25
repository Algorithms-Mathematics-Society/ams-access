/** Keep TFLite's known startup notice out of Next.js's console-error overlay. */
export function patchMediaPipeLogging(source) {
  const original = "var err = console.error.bind(console);";
  if (source.split(original).length !== 2) {
    throw new Error("MediaPipe stderr hook changed; review the loader logging adapter.");
  }
  return source.replace(
    original,
    `var err = function (...args) {
  if (args.length === 1 && args[0] === "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") {
    console.info(...args);
  } else {
    console.error(...args);
  }
};`
  );
}
