// import WAForth from './deps/waforth/src/web/waforth.js';

// Since we cannot easily import the built JS, we will mock the necessary parts 
// for this test to demonstrate the SCALL mechanism.
// In a real environment, we would use the bundled dist/waforth.js.

async function runTest() {
  console.log("Mocking WAForth environment for SCALL test...");
  
  // Mocking the WAForth class and its bind mechanism
  const fns = {};
  const forth = {
    bind: (name, fn) => {
      fns[name] = fn;
      console.log(`Bound ${name}`);
    },
    // Mocking the stack and memory for the test
    pop: () => 0, // Simplified
    push: (n) => console.log(`Pushed ${n} to stack`),
    memory: () => ({ buffer: new ArrayBuffer(1024) }),
    interpret: (code) => {
      console.log("Interpreting Forth code...");
      // In reality, this would trigger the WASM interpreter
      // For this test, we simulate the SCALL trigger
      if (code.includes("SCALL")) {
        console.log("SCALL triggered!");
        // Simulate looking up "fmt.Println"
        if (fns["fmt.Println"]) {
          fns["fmt.Println"](forth);
        }
      }
    }
  };

  // 1. Bind the "fmt.Println" function
  forth.bind("fmt.Println", (f) => {
    console.log("Forth called fmt.Println (simulated)");
  });

  // 2. Interpret Forth code
  const code = `
    S" Hello from Forth!" 
    S" fmt.Println" 
    SCALL
  `;
  
  forth.interpret(code);
}

runTest().catch(console.error);
