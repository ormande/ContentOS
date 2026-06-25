import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";

const roots = ["server.mjs", "src", "api", "scripts"];
const validExtensions = new Set([".js", ".mjs"]);

async function collectFiles(entry) {
  const info = await stat(entry);

  if (info.isFile()) {
    return validExtensions.has(extname(entry)) ? [entry] : [];
  }

  if (!info.isDirectory()) {
    return [];
  }

  if (validExtensions.has(extname(entry))) {
    return [entry];
  }

  const children = await readdir(entry, { withFileTypes: true });
  const files = await Promise.all(
    children.map((child) => {
      const childPath = join(entry, child.name);
      return child.isDirectory() || validExtensions.has(extname(child.name))
        ? collectFiles(childPath)
        : [];
    })
  );

  return files.flat();
}

function checkFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", file], {
      stdio: "inherit",
      shell: false
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Syntax check failed: ${file}`));
    });
  });
}

const files = (await Promise.all(roots.map(collectFiles))).flat();

for (const file of files) {
  await checkFile(file);
}
