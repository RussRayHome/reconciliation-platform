# Developer Setup

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- VS Code

## Install and Run

```bash
npm install
npm run dev
```

The root `dev` script starts both apps together:

- API on port `4000`
- Web on port `5173`

## Useful Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
npm run security:scan
```

## VS Code Support

The repository includes:

- recommended extensions in `.vscode/extensions.json`
- format and lint settings in `.vscode/settings.json`
- runnable tasks in `.vscode/tasks.json`
- launch configurations in `.vscode/launch.json`

## Environment Variables

Copy values from `.env.example` as needed.

- `PORT`: API port
- `VITE_API_BASE_URL`: backend base URL for the web app
- `LOG_LEVEL`: Pino log level
- `DEBUG_RECONCILIATION`: optional debug switch for future deeper tracing
- `MAX_UPLOAD_MB`: upload cap for source files
- `JAVA_HOME`: JDK home for Python- or JVM-backed tooling on macOS
- `JAVA_BIN`: explicit `java` executable path when a library cannot resolve `PATH`

## Java / Python Interop on macOS

If Java was installed with Homebrew, make sure `JAVA_HOME` points to the JDK root and **not** the `bin` folder.

Recommended shell setup:

```bash
export JAVA_HOME=$(/usr/libexec/java_home)
export PATH="$JAVA_HOME/bin:$PATH"
```

The workspace also includes local `.env` and VS Code settings that point Python tooling at the detected Brew JDK for this machine.

## Generating Sample Workbooks

```bash
npm run fixtures:generate
```

This writes sample `.xlsx` inputs under `docs/sample-files` for local experimentation.

## Class and Method Documentation

When changing reconciliation logic, update `docs/class-method-reference.md` in the same pull request.

Documentation requirements for each newly exported class method or function:

- list inputs
- list outputs
- include method state object before execution
- include method state object after execution
