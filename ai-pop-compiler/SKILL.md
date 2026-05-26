---
name: ai-pop-compiler
description: Sub-skill for validating the artist.json metadata contract, copying files, compiling typescript/Vite templates, and verifying static client builds.
license: Apache-2.0
---

# AI Pop Compiler

This skill handles validation, scaffolding, and client compilation checks. It utilizes the embedded Go CLI scaffolder program located inside the skill's assets directory.

## Embedded Resources

The complete Go-based scaffolder source code and its Web Component template bundles are bundled inside this skill:
*   [Go Main Program](assets/scaffolder/main.go)
*   [Web Component Templates](assets/scaffolder/templates.go)
*   [Go Mod definition](assets/scaffolder/go.mod)

By embedding this code, any agent loading this skill can instantly scaffold or maintain an artist page on-demand.

## Instructions

1. **Verify Contract:**
   * Confirm that the compiled `artist.json` file in the artist workspace is well-formed and matches our strict data contract schema.

2. **Compile the Go Scaffolder On-Demand:**
   * Before running the scaffolder, check if the executable is compiled. If not, build it from the embedded asset source.
   * **Note on Read-Only Environments:** If the skill folder is read-only, compile the binary directly to your writable target artist workspace:
     ```bash
     # Compile the Go CLI tool directly into the writable target workspace
     go build -o /path/to/artist_workspace/ai-pop-scaffolder \
       /path/to/skills/ai-pop-compiler/assets/scaffolder/main.go \
       /path/to/skills/ai-pop-compiler/assets/scaffolder/templates.go
     ```
   * Otherwise, if the environment is writable, you may build locally:
     ```bash
     cd assets/scaffolder
     go build -o ai-pop-scaffolder
     ```

3. **Run Scaffolder:**
   * Run the compiled binary on the target artist directory containing `artist.json`:
     ```bash
     /path/to/ai-pop-scaffolder --dir /path/to/artist_workspace
     ```
   * Confirm that all source files and media assets are written to the `web` subdirectory.

4. **Execute Compiler & Portable Packaging:**
   * Navigate into the newly created `web` folder.
   * **Node Modules Workaround:** If `npm install` times out or fails due to permission constraints, recursively copy `node_modules` from an existing sibling artist project using the pre-authorized command:
     ```bash
     cp -R ../../sibling-project/web/node_modules ./node_modules
     ```
   * **Portable Build base:** Ensure `vite.config.js` contains `base: './'`.
   * Run the pre-authorized `npm run build` to compile files to `dist/`.
   * **Standalone ZIP Distribution:** Package the production build into a portable standalone zip file using the pre-authorized command:
     ```bash
     zip -r [Artist_Name]_Player.zip dist
     ```
