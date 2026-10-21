import { test } from "node:test";
import assert from "node:assert/strict";
import { cpp } from "@codemirror/lang-cpp";
import { formatSource } from "./format-code.ts";

const CPP = [cpp()];

test("re-indents a mangled function body", () => {
  const ugly = ["int main() {", "int x = 1;", "if (x) {", "x = 2;", "}", "return x;", "}"].join(
    "\n"
  );
  const out = formatSource(ugly, CPP);
  assert.equal(
    out,
    [
      "int main() {",
      "    int x = 1;",
      "    if (x) {",
      "        x = 2;",
      "    }",
      "    return x;",
      "}",
    ].join("\n")
  );
});

test("formatting is idempotent", () => {
  const ugly = "int f() {\nreturn 0;\n}";
  const once = formatSource(ugly, CPP);
  assert.equal(formatSource(once, CPP), once);
});

test("only leading whitespace moves, so no character of the program is lost", () => {
  const ugly = 'int main(){\nstd::cout << "a  b" << "\\n";\nreturn 0;\n}';
  const out = formatSource(ugly, CPP);
  const strip = (s) => s.replace(/^[ \t]+/gm, "");
  assert.equal(strip(out), strip(ugly));
  // The string literal's own double space survives.
  assert.ok(out.includes('"a  b"'));
});

test("access specifiers stay at the class's own level", () => {
  const src = ["class Dog {", "public:", "Dog() {}", "private:", "int age_;", "};"].join("\n");
  const out = formatSource(src, CPP).split("\n");
  // The grammar indents these as statements inside the class body; C++ is not
  // written that way anywhere, so they are put back.
  assert.equal(out[1], "public:");
  assert.equal(out[3], "private:");
  // The members between them still get their level.
  assert.equal(out[2], "    Dog() {}");
  assert.equal(out[4], "    int age_;");
});

test("tab indentation is normalised to the contest's own unit", () => {
  const src = ["class Dog {", "\tpublic:", "\tint age_;", "};"].join("\n");
  const out = formatSource(src, CPP).split("\n");
  // indentRange rewrites leading whitespace with the configured unit, so a
  // file pasted in with tabs comes out matching everything around it.
  assert.equal(out[1], "public:");
  assert.equal(out[2], "    int age_;");
  assert.ok(!out.some((line) => line.includes("\t")));
});

test("empty and whitespace-only input come back untouched", () => {
  assert.equal(formatSource("", CPP), "");
  assert.equal(formatSource("   \n  ", CPP), "   \n  ");
});

test("formats a function beyond the initial parser viewport", () => {
  const prefix = "// padding to exceed the initial parser viewport\n".repeat(500);
  const input = prefix + "int main() {\nreturn 0;\n}";
  const output = formatSource(input, CPP);
  assert.equal(output.slice(0, prefix.length), prefix);
  assert.equal(output.slice(prefix.length), "int main() {\n    return 0;\n}");
});
