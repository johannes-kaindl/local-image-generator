// Build → main.js. obsidian/electron extern (Store-Regel: kein Laufzeit-Nachladen
// von Code — Spec §3/§10).
import esbuild from "esbuild";

const prod = process.argv.includes("--production");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  loader: { ".json": "json" },
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
  console.log("esbuild: watching…");
}
