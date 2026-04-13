# Project Scope: Go-to-Forth Multitasking Environment

## Stage 1: Foundation & Test Harness
*   **Purpose**: Establish a robust, browser-based environment for Wasm and Web Workers.
*   **Components**:
    *   **Browser-based Wasm Loader**: Infrastructure to load and instantiate pre-compiled Wasm modules in the browser.
    *   **Web Worker Infrastructure**: Setup for spawning and managing Web Workers.
    *   **Headless Test Suite**: A test runner (e.g., Vitest/Mocha) capable of running in a headless browser environment, with support for capturing console logs from workers.

## Stage 2: Minimal Transpiler (The "fmt" Milestone)
*   **Purpose**: Build the core transpiler and prove end-to-end functionality.
*   **Components**:
    *   **Go-to-Forth Transpiler**: Minimal implementation focusing on basic Go SSA/IR mapping to Forth.
    *   **Wasm Library Integration**: The runtime loads pre-compiled Wasm modules (e.g., a Go-compiled `fmt` library) and bridges them to the Forth environment.

## Stage 3: Ecosystem Expansion
*   **Purpose**: Scale the system by adding library support and optimizations.
*   **Components**:
    *   **GitHub-based Builder**: CI/CD pipeline for pre-compiling Go libraries to Wasm (outside the browser).
    *   **Performance Optimization**: Implement budget-based scheduling and op-code fusion.
    *   **Advanced Tooling**: Observability dashboard, LSP integration, and security sandboxing.
