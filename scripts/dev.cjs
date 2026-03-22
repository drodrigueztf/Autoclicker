const { spawn } = require("node:child_process");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(cmd, ["electron-vite", "dev"], {
  stdio: "inherit",
  env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
