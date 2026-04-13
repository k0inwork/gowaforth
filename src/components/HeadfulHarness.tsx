// src/components/HeadfulHarness.tsx
import React, { useState } from 'react';
import { transpile } from '../transpiler/transpiler';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { createFsFromVolume, Volume } from 'memfs';
import JSZip from 'jszip';

const fs = createFsFromVolume(new Volume());

const defaultYaml = `name: Headless Browser Pipeline
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Download go2json
        run: curl -O https://raw.githubusercontent.com/CreativeInquiry/go2json/master/go2json.js
      - name: Generate AST
        run: node go2json.js main.go ast.json
      - name: Run Transpilation & Tests
        run: node headless-test.js > test-artifacts.log
        env:
          GITHUB_RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
      - name: Upload Artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-artifacts
          path: |
            ast.json
            test-artifacts.log
            output.fth
`;

export function HeadfulHarness() {
  const [goSource, setGoSource] = useState(`package main

import "fmt"

type Rect struct {
    Width  int
    Height int
}

func main() {
    var r Rect
    r.Width = 10
    r.Height = 20
    
    area := r.Width * r.Height
    fmt.Println(area)
    
    if area > 100 {
        fmt.Println("Large area")
    } else {
        fmt.Println("Small area")
    }
    
    x := 10
    p := &x
    *p = 20
    fmt.Println(x) // Should be 20
    
    for i := 0; i < 5; i++ {
        switch i {
        case 0:
            fmt.Println("Zero")
        case 1:
            fmt.Println("One")
        default:
            fmt.Println("Many")
        }
    }
}`);
  const [pipelineYaml, setPipelineYaml] = useState(defaultYaml);
  const [astOutput, setAstOutput] = useState('');
  const [forthOutput, setForthOutput] = useState('');
  const [testLogs, setTestLogs] = useState('');
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [workflowUrl, setWorkflowUrl] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');

  const log = (message: string) => {
    setPipelineLogs((prev) => [...prev, message]);
  };

  React.useEffect(() => {
    localStorage.setItem('repoUrl', repoUrl);
    localStorage.setItem('token', token);
  }, [repoUrl, token]);

  const cleanRepoUrl = (url: string) => {
    return url.replace(/^https?:\/\/(github\.com\/)?/, '').replace(/\/$/, '');
  };

  const handleTranspile = () => {
    const output = transpile(goSource);
    setForthOutput(output);
  };

  const handlePushAndRun = async () => {
    setPipelineLogs([]);
    setWorkflowUrl(null);
    setAstOutput('');
    setForthOutput('');
    setTestLogs('');
    log('Starting pipeline orchestration...');
    
    try {
      // 1. Initialize Git
      log('Initializing Git...');
      await git.init({ fs, dir: '/' });
      
      // 2. Create temp branch
      const branchName = 'temp-pipeline-' + Date.now();
      log(`Creating branch: ${branchName}`);
      log(`Branch URL: https://github.com/${repoUrl}/tree/${branchName}`);
      await git.branch({ fs, dir: '/', ref: branchName, checkout: true });
      
      // 3. Write workflow file
      log('Writing workflow, source, and test files...');
      await fs.promises.mkdir('/.github/workflows', { recursive: true });
      await fs.promises.writeFile('/.github/workflows/pipeline.yml', pipelineYaml);
      await fs.promises.writeFile('/main.go', goSource);

      const testScript = `const fs = require('fs');
const runUrl = process.env.GITHUB_RUN_URL;

class SymbolTable {
  constructor() {
    this.scopes = [new Map()];
  }
  pushScope() { this.scopes.push(new Map()); }
  popScope() { this.scopes.pop(); }
  define(name, type) {
    this.scopes[this.scopes.length - 1].set(name, { name, type });
    return name;
  }
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name).name;
    }
    return null;
  }
  lookupType(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name).type;
    }
    return null;
  }
}

function emit(ast) {
  let forth = "";
  const symbolTable = new SymbolTable();
  const declaredVars = new Set();
  const declaredStructs = new Set();

  const precedence = {
    '*': 3, '/': 3, '%': 3,
    '+': 2, '-': 2,
    '==': 1, '!=': 1, '<': 1, '<=': 1, '>': 1, '>=': 1
  };

  const opMap = {
    '==': '=', '!=': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=',
    '+': '+', '-': '-', '*': '*', '/': '/', '%': 'MOD'
  };

  function handleExpression(tokens, isLValue = false) {
    const outputQueue = [];
    const operatorStack = [];

    tokens.forEach((token, index) => {
      if (token.tag === 'number' || token.tag === 'string' || token.tag === 'ident' || token.tag === 'call' || token.tag === 'access') {
        outputQueue.push(token);
      } else if (token.tag === 'op') {
        const op = token.value;
        const prev = tokens[index - 1];
        const isUnary = !prev || prev.tag === 'op';

        if (isUnary && (op === '&' || op === '*')) {
           operatorStack.push({ tag: 'unary', value: op });
           return;
        }

        while (operatorStack.length > 0 && 
               operatorStack[operatorStack.length - 1].tag !== 'unary' &&
               precedence[operatorStack[operatorStack.length - 1].value] >= precedence[op]) {
          outputQueue.push(operatorStack.pop());
        }
        operatorStack.push(token);
      }
    });

    while (operatorStack.length > 0) {
      outputQueue.push(operatorStack.pop());
    }

    outputQueue.forEach(token => {
      if (token.tag === 'op') {
        if (token.value === '++') forth += "1 + ";
        else if (token.value === '--') forth += "1 - ";
        else forth += (opMap[token.value] || token.value) + " ";
      } else if (token.tag === 'unary') {
        if (token.value === '*') forth += "@ ";
        else if (token.value === '&') {
           if (forth.endsWith('@ ')) {
             forth = forth.slice(0, -2);
           }
        }
      } else {
        walk(token, isLValue);
      }
    });
  }

  function walk(node, isLValue = false) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const current = node[i];
        if (current.tag === 'if') {
          walk(current.condition);
          forth += "IF \\n";
          walk(current.body);
          
          let j = i + 1;
          while (j < node.length && node[j] && (node[j].tag === 'elseif' || node[j].tag === 'else')) {
            if (node[j].tag === 'elseif') {
              forth += "ELSE \\n";
              walk(node[j].condition);
              forth += "IF \\n";
              walk(node[j].body);
            } else if (node[j].tag === 'else') {
              forth += "ELSE \\n";
              walk(node[j].body);
            }
            j++;
          }
          for (let k = i + 1; k < j; k++) {
             if (node[k].tag === 'elseif') forth += "THEN \\n";
          }
          forth += "THEN \\n";
          i = j - 1;
        } else {
          walk(current);
        }
      }
      return;
    }

    switch (node.tag) {
      case 'package': break;
      case 'func':
        forth += ": " + node.name + " \\n";
        symbolTable.pushScope();
        if (node.args) walk(node.args);
        walk(node.body);
        symbolTable.popScope();
        forth += "; \\n";
        break;
      case 'declare':
        node.names.forEach(name => {
          const type = node.type ? (node.type.tag === 'ident' ? node.type.value : node.type.tag) : 'auto';
          if (declaredStructs.has(type)) {
             forth = "CREATE " + name + " 16 ALLOT \\n" + forth; 
          } else if (!declaredVars.has(name)) {
            forth = "VARIABLE " + name + " \\n" + forth;
            declaredVars.add(name);
          }
          symbolTable.define(name, type);
          if (node.value) {
            if (node.value.tag === 'expr') handleExpression(node.value.body);
            else walk(node.value);
            forth += name + " ! \\n";
          }
        });
        break;
      case 'assign':
        if (node.lhs.tag === 'expr' && node.lhs.body[0].tag === 'unary' && node.lhs.body[0].value === '*') {
           walk(node.rhs);
           handleExpression(node.lhs.body.slice(1)); 
           forth += "! \\n";
        } else {
           walk(node.rhs);
           walk(node.lhs, true);
           forth += "! \\n";
        }
        break;
      case 'if': break;
      case 'switch':
        if (node.tag === 'switch') {
           if (node.init) walk(node.init);
           if (node.expr) walk(node.expr);
           else forth += "1 "; 
           
           const cases = Array.isArray(node.body) ? node.body : (node.body && node.body.list ? node.body.list : []);
           let caseCount = 0;
           let defaultCase = null;

           cases.forEach(cas => {
             if (cas.tag === 'case') {
               const vals = cas.list || cas.values || [];
               vals.forEach(val => {
                 forth += "DUP ";
                 walk(val);
                 forth += "= IF \\n";
                 walk(cas.body);
                 forth += "ELSE \\n";
                 caseCount++;
               });
             } else if (cas.tag === 'default') {
               defaultCase = cas;
             }
           });

           if (defaultCase) {
             walk(defaultCase.body);
           }

           for (let k = 0; k < caseCount; k++) {
             forth += "THEN \\n";
           }
           forth += "DROP \\n"; 
        }
        break;
      case 'for':
        if (node.headers && node.headers[0]) walk(node.headers[0]);
        forth += "BEGIN \\n";
        if (node.headers && node.headers[1] && node.headers[1].body && node.headers[1].body.length > 0) {
          walk(node.headers[1]);
        } else {
          forth += "1 ";
        }
        forth += "WHILE \\n";
        walk(node.body);
        if (node.headers && node.headers[2]) walk(node.headers[2]);
        forth += "REPEAT \\n";
        break;
      case 'typedef':
        declaredStructs.add(node.name);
        let offset = 0;
        node.fields.forEach(field => {
          forth += offset + " CONSTANT " + node.name + "." + field.name + " \\n";
          offset += 4;
        });
        forth += offset + " CONSTANT " + node.name + ".size \\n";
        break;
      case 'ident':
        const varName = symbolTable.lookup(node.value);
        const varType = symbolTable.lookupType(node.value);
        if (varName) {
           forth += varName + " ";
           if (!isLValue && !declaredStructs.has(varType)) forth += "@ ";
        } else forth += node.value + " ";
        break;
      case 'number':
        forth += node.value + " ";
        break;
      case 'exec': walk(node.expr); break;
      case 'expr': 
        if (node.body.length === 2 && node.body[0].tag === 'ident' && (node.body[1].value === '++' || node.body[1].value === '--')) {
           const varName = symbolTable.lookup(node.body[0].value) || node.body[0].value;
           const op = node.body[1].value === '++' ? '1 +' : '1 -';
           forth += varName + " @ " + op + " " + varName + " ! \\n";
        } else {
           handleExpression(node.body, isLValue);
        }
        break;
      case 'call':
        let funcName = "";
        if (node.func.tag === 'access') funcName = node.func.struct.value + "." + node.func.member;
        else if (node.func.tag === 'ident') funcName = node.func.value;
        if (funcName) {
          if (node.args) walk(node.args);
          forth += 'S" ' + funcName + '" SCALL \\n';
        }
        break;
      case 'access':
        const structType = symbolTable.lookupType(node.struct.value);
        walk(node.struct, isLValue);
        if (structType && structType !== 'auto') {
           forth += structType + "." + node.member + " + ";
        } else {
           forth += node.member + " + ";
        }
        if (!isLValue) forth += "@ ";
        break;
      case 'string':
        forth += 'S" ' + node.value.slice(1, -1) + '" ';
        break;
      case 'op':
        if (node.value === '++') forth += "1 + ";
        else if (node.value === '--') forth += "1 - ";
        else forth += (opMap[node.value] || node.value) + " ";
        break;
      default:
        console.warn('Unhandled node tag:', node.tag);
    }
  }

  walk(ast);
  return forth;
}

console.log('Starting Node.js transpilation environment...');
if (runUrl) {
  console.log('GitHub Run URL:', runUrl);
}

console.log('Reading AST from go2json...');
try {
  const astRaw = fs.readFileSync('ast.json', 'utf8');
  const ast = JSON.parse(astRaw);
  console.log('AST successfully loaded. Ready for Forth emission.');
  
  let forthOutput = "";
  try {
    forthOutput = emit(ast);
  } catch (emitErr) {
    console.error('Error during Forth emission:', emitErr);
    console.error('Stack trace:', emitErr.stack);
    process.exit(1);
  }
  fs.writeFileSync('output.fth', forthOutput);
  console.log('Emitted output.fth');
  console.log('--- FORTH START ---');
  console.log(forthOutput);
  console.log('--- FORTH END ---');
  
} catch (err) {
  console.error('Failed to read or parse ast.json:', err);
  process.exit(1);
}

console.log('Node.js tests completed successfully.');
`;
      await fs.promises.writeFile('/headless-test.js', testScript);
      
      // 4. git.add, git.commit, git.push
      log('Adding and committing...');
      await git.add({ fs, dir: '/', filepath: '.github/workflows/pipeline.yml' });
      await git.add({ fs, dir: '/', filepath: 'main.go' });
      await git.add({ fs, dir: '/', filepath: 'headless-test.js' });
      await git.commit({ fs, dir: '/', message: 'Add headless browser test pipeline', author: { name: 'User', email: 'user@example.com' } });
      
      log('Pushing to GitHub...');
      await git.addRemote({ fs, dir: '/', remote: 'origin', url: `https://cors.isomorphic-git.org/github.com/${repoUrl}.git` });
      await git.push({ 
        fs, 
        http, 
        dir: '/', 
        remote: 'origin', 
        ref: branchName, 
        onAuth: () => ({ username: token }) 
      });
      
      log('Push complete. Waiting for workflow run to start...');
      
      // 5. Poll for results
      let runId = null;
      let urlLogged = false;
      for (let i = 0; i < 20; i++) {
        const runsResponse = await fetch(`https://api.github.com/repos/${repoUrl}/actions/runs?branch=${branchName}`, {
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const runs = await runsResponse.json();
        const latestRun = runs.workflow_runs?.[0];
        
        if (latestRun) {
          if (!urlLogged) {
            log(`Workflow Run URL: ${latestRun.html_url}`);
            setWorkflowUrl(latestRun.html_url);
            urlLogged = true;
          }
          if (latestRun.status === 'completed') {
            log(`Pipeline finished with conclusion: ${latestRun.conclusion}`);
            runId = latestRun.id;
            break;
          }
        } else {
          log(`Waiting for run to appear (attempt ${i + 1})...`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      if (runId) {
        log('Fetching artifacts...');
        const artifactsResponse = await fetch(`https://api.github.com/repos/${repoUrl}/actions/runs/${runId}/artifacts`, {
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const artifactsData = await artifactsResponse.json();
        const artifact = artifactsData.artifacts?.find((a: any) => a.name === 'test-artifacts');
        
        if (artifact) {
          log('Downloading artifact zip...');
          const zipResponse = await fetch(artifact.archive_download_url, {
            headers: { 'Authorization': `token ${token}` }
          });
          const zipBlob = await zipResponse.blob();
          
          log('Extracting artifacts...');
          const zip = await JSZip.loadAsync(zipBlob);
          
          if (zip.file('ast.json')) {
            const astContent = await zip.file('ast.json')!.async('string');
            setAstOutput(astContent);
          }
          if (zip.file('output.fth')) {
            const forthContent = await zip.file('output.fth')!.async('string');
            setForthOutput(forthContent);
          }
          if (zip.file('test-artifacts.log')) {
            const logContent = await zip.file('test-artifacts.log')!.async('string');
            setTestLogs(logContent);
          }
          log('Artifacts loaded successfully.');
        } else {
          log('No artifacts found for this run.');
        }
      }

      // 6. Cleanup
      log('Cleaning up remote branch...');
      await fetch(`https://api.github.com/repos/${repoUrl}/git/refs/heads/${branchName}`, {
        method: 'DELETE',
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      log('Deleted temporary branch.');

      log('Pipeline complete.');
    } catch (error) {
      log(`Error: ${error}`);
      console.error('Pipeline orchestration failed:', error);
    }
  };

  return (
    <div className="p-4 border rounded shadow">
      <h2 className="text-xl font-bold mb-4">Go-to-Forth Compiler & Pipeline</h2>
      
      <div className="mb-4">
        <h3 className="font-bold">Git Settings:</h3>
        <input 
          className="w-full p-2 border mb-2" 
          placeholder="Repo URL (e.g. user/repo)" 
          value={repoUrl} 
          onChange={(e) => setRepoUrl(e.target.value)} 
          onBlur={(e) => setRepoUrl(cleanRepoUrl(e.target.value))}
        />
        <input className="w-full p-2 border mb-2" type="password" placeholder="GitHub Token" value={token} onChange={(e) => setToken(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <h3 className="font-bold mb-2">Go Source:</h3>
          <textarea
            className="w-full p-2 border font-mono text-sm"
            rows={10}
            value={goSource}
            onChange={(e) => setGoSource(e.target.value)}
          />
        </div>
        <div>
          <h3 className="font-bold mb-2">Pipeline YAML:</h3>
          <textarea
            className="w-full p-2 border font-mono text-sm"
            rows={10}
            value={pipelineYaml}
            onChange={(e) => setPipelineYaml(e.target.value)}
          />
        </div>
      </div>
      
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={handleTranspile}>
          Transpile
        </button>
        <button className="px-4 py-2 bg-green-500 text-white rounded" onClick={handlePushAndRun}>
          Push & Run Pipeline
        </button>
      </div>

      <div className="mt-4">
        <h3 className="font-bold">Forth Output:</h3>
        <pre className="bg-gray-100 p-2 mt-2">{forthOutput}</pre>
      </div>

      {pipelineLogs.length > 0 && (
        <div className="mt-4">
          <h3 className="font-bold flex items-center gap-2">
            Pipeline Logs:
            {workflowUrl && (
              <a 
                href={workflowUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-sm font-normal text-blue-500 hover:underline"
              >
                (View on GitHub)
              </a>
            )}
          </h3>
          <pre className="bg-gray-900 text-green-400 p-2 mt-2 text-sm overflow-x-auto h-48 overflow-y-auto">
            {pipelineLogs.join('\n')}
          </pre>
        </div>
      )}

      {(astOutput || testLogs) && (
        <div className="mt-8 border-t pt-4">
          <h2 className="text-xl font-bold mb-4">Pipeline Artifacts</h2>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h3 className="font-bold mb-2">Generated AST (ast.json):</h3>
              <textarea
                className="w-full p-2 border font-mono text-xs bg-gray-50"
                rows={15}
                readOnly
                value={astOutput}
              />
            </div>
            <div>
              <h3 className="font-bold mb-2">Execution Logs (test-artifacts.log):</h3>
              <textarea
                className="w-full p-2 border font-mono text-xs bg-gray-50"
                rows={15}
                readOnly
                value={testLogs}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
