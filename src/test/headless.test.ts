// src/test/headless.test.ts
import { describe, it, expect } from 'vitest';
import { transpile } from '../transpiler/transpiler';

describe('Headless Transpiler Harness', () => {
  it('should transpile a simple Go function to Forth', () => {
    const goSource = 'func main() { fmt.Println("Hello, World!") }';
    const forthOutput = transpile(goSource);
    
    // Simple assertion for now
    expect(forthOutput).toContain(': main');
    expect(forthOutput).toContain('." Hello, World!"');
  });
});
