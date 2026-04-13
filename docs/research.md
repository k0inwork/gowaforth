# Architecture Proposal: Cooperative Multitasking in WaForth via F-on-F Threading

## 1. Foundations: Lowering Go to Forth execution tokens
The primary challenge in a Go-to-Forth transpiler is mapping Go's Static Single Assignment (SSA) intermediate representation to Forth’s stack-based, execution-token (XT) model. A transpiler targeting an F-on-F model can achieve higher efficiency by treating Forth words as discrete basic blocks.

### SSA to Forth Word Mapping
A Go compiler can lower its SSA blocks into a sequence of Forth execution tokens.
*   **Basic Blocks**: Each SSA basic block in a Go function maps to a Forth word or a sequence of execution tokens in linear memory.
*   **Phi Nodes**: Go's SSA "phi" nodes are resolved into Forth stack manipulations (e.g., `PICK`, `ROLL`, or simple `IF`/`ELSE` constructs) before execution.
*   **Variable Handling**: Go's local variables with fixed static scope are optimized into Forth stack values, while variables whose addresses are taken are stored in the task's dedicated user area in linear memory.

## 2. Mapping the Go Runtime to the Forth TASK Structure
To support "goroutine-like" behavior, the Forth TASK structure is extended to encompass the metadata required by the Go runtime.

| Offset | Field | Description |
| :--- | :--- | :--- |
| `0x00` | `IP` | Instruction Pointer for the Forth inner interpreter. |
| `0x04` | `DSP/RSP` | Data and Return stack pointers within the task's memory segment. |
| `0x14` | `STATUS` | Maps to Go's goroutine states (Runnable, Running, Waiting, Syscall). |
| `0x18` | `G-ADDR` | A pointer to the "G" structure (goroutine descriptor). |
| `0x1C` | `LIMIT` | Stack limit for the task to support Go-style dynamic stack growth. |

### Context Switching via runtime.gogo
In a native Go environment, `runtime.gogo` performs the jump to a saved execution context. In the F-on-F model, this is replaced by the Forth DISPATCH loop, which swaps the `CURRENT-TASK` pointer and resumes interpretation from the saved `IP` in linear memory.

## 3. Implementing Go Concurrency in the Hybrid Data Plane
Go's concurrency model relies on Message Passing (Channels) and Shared Memory (Atomics/Mutexes).

### The Control Plane: Channel Operations
Go channels are implemented using the "dungeon" message bus or a circular buffer in shared linear memory.
*   **Send/Receive**: These words implicitly call `YIELD` if the buffer is full (send) or empty (receive).
*   **Select**: A complex Forth word that iterates through task-local "wait lists" associated with various channels, yielding control until one becomes ready.

### The Data Plane: Atomics and Lock-Free Sync
Because Go supports interior pointers and shared memory, the transpiler utilizes WebAssembly's atomic instructions for high-frequency synchronization.
*   **ATOMIC-CAS**: The `i32.atomic.rmw.cmpxchg` instruction is the essential primitive for implementing Go's `sync/atomic` package and mutexes.
*   **Wait/Notify**: Use `memory.atomic.wait` and `memory.atomic.notify` within the Forth kernel to suspend/wake Wasm Workers hosting the Forth dispatcher.

## 4. Stack Management and Dynamic Growth
The F-on-F model manages multiple stacks in a single linear memory space.
*   **Segmented Stacks**: Each task is assigned a segment. The transpiler instruments function prologues to check if the current stack pointer exceeds the `LIMIT` field in the `TASK` structure.
*   **Growth Logic**: When a stack overflow is detected, the kernel allocates a new, larger segment and copies the existing stack data. Because stacks are in linear memory, pointers can be updated safely.

## 5. Compiler Instrumentation: Strategic Yielding
To mimic Go's cooperative multitasking, the transpiler "sprinkles" yield points strategically.
*   **Function Prologues**: Inserting a `?YIELD` check at the start of every Forth word ensures regular context switches.
*   **Tight Loops**: Every backward branch in a Go `for` loop must include a `YIELD` check to prevent deadlocks.
*   **I/O and Blocking Calls**: Any word mapping to a Go system call or I/O operation must implicitly yield to maintain system responsiveness.

## 6. Performance and Optimization for Indirect Dispatch
The execution cost of an F-on-F interpreter is driven by `call_indirect` overhead.
*   **Tail Call Optimization**: Use `return_call_indirect` for the Forth `NEXT` operation to discard the Wasm call frame.
*   **Op-code Fusion**: Perform "peephole optimization" on Forth word sequences, combining common Go instruction patterns into "super-instructions."
*   **Stack-Value Caching**: Keep the Top-Of-Stack (TOS) in a Wasm local variable within the dispatcher loop to minimize linear memory loads/stores.

## 7. Memory Safety and Isolation
*   **Pointer Masking**: All Go pointer arithmetic in linear memory is masked against task segment boundaries.
*   **Bounds Checking**: Redefine Forth `@` and `!` primitives to include runtime checks, ensuring they stay within the "sandboxed" region assigned to the task.

## 8. Emerging Alternatives: WasmFX and JSPI
While the F-on-F model is highly portable, emerging Wasm features provide high-performance alternatives for future iterations:
*   **JSPI (JavaScript Promise Integration)**: Allows synchronous Wasm code to interact with asynchronous JS APIs.
*   **WasmFX (Stack Switching)**: A proposed extension for native stack manipulation using continuations.

Until these proposals reach full standardization, the F-on-F model remains the most reliable and portable architecture for a cross-environment Go-to-Forth compiler.
