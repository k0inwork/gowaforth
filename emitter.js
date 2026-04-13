const fs = require('fs');

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

        // Handle unary & and *
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
        if (token.value === '++') forth += `1 + `;
        else if (token.value === '--') forth += `1 - `;
        else forth += `${opMap[token.value] || token.value} `;
      } else if (token.tag === 'unary') {
        if (token.value === '*') forth += `@ `;
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
          forth += `IF \n`;
          walk(current.body);
          
          let j = i + 1;
          while (j < node.length && node[j] && (node[j].tag === 'elseif' || node[j].tag === 'else')) {
            if (node[j].tag === 'elseif') {
              forth += `ELSE \n`;
              walk(node[j].condition);
              forth += `IF \n`;
              walk(node[j].body);
            } else if (node[j].tag === 'else') {
              forth += `ELSE \n`;
              walk(node[j].body);
            }
            j++;
          }
          for (let k = i + 1; k < j; k++) {
             if (node[k].tag === 'elseif') forth += `THEN \n`;
          }
          forth += `THEN \n`;
          i = j - 1;
        } else {
          walk(current);
        }
      }
      return;
    }

    switch (node.tag) {
      case 'package': break;
      case 'block':
        walk(node.list || node.List);
        break;
      case 'func':
        forth += `: ${node.name} \n`;
        symbolTable.pushScope();
        if (node.args) walk(node.args);
        walk(node.body);
        symbolTable.popScope();
        forth += `; \n`;
        break;
      case 'declare':
        node.names.forEach(name => {
          const type = node.type ? (node.type.tag === 'ident' ? node.type.value : node.type.tag) : 'auto';
          if (declaredStructs.has(type)) {
             // For structs, we need to allot memory. 
             // We'll use a helper to get the size if we had one, but for now we'll assume 16 bytes or use the .size constant if it exists.
             forth = `CREATE ${name} 16 ALLOT \n` + forth; 
          } else if (!declaredVars.has(name)) {
            forth = `VARIABLE ${name} \n` + forth;
            declaredVars.add(name);
          }
          symbolTable.define(name, type);
          if (node.value) {
            if (node.value.tag === 'expr') handleExpression(node.value.body);
            else walk(node.value);
            forth += `${name} ! \n`;
          }
        });
        break;
      case 'assign':
        if (node.lhs.tag === 'expr' && node.lhs.body[0].tag === 'unary' && node.lhs.body[0].value === '*') {
           // Dereference assignment: *p = val
           walk(node.rhs);
           handleExpression(node.lhs.body.slice(1)); // Pushes address p
           forth += `! \n`;
        } else {
           walk(node.rhs);
           walk(node.lhs, true);
           forth += `! \n`;
        }
        break;
      case 'if':
        // Handled in array walk
        break;
      case 'switch':
        if (node.tag === 'switch') {
           if (node.init) walk(node.init);
           const switchExpr = node.expr || node.condition;
           if (switchExpr) walk(switchExpr);
           else forth += "1 "; 
           
           const cases = node.cases || (Array.isArray(node.body) ? node.body : (node.body ? (node.body.list || node.body.List || []) : []));
           let caseCount = 0;
           let defaultCase = null;

           cases.forEach(cas => {
             if (cas.tag === 'case' || cas.tag === 'CaseClause') {
               const vals = cas.list || cas.List || cas.values || (cas.condition ? [cas.condition] : []);
               vals.forEach(val => {
                 forth += "DUP ";
                 walk(val);
                 forth += "= IF \n";
                 walk(cas.body || cas.Body);
                 forth += "ELSE \n";
                 caseCount++;
               });
             } else if (cas.tag === 'default' || (cas.tag === 'CaseClause' && !cas.List && !cas.condition)) {
               defaultCase = cas;
             }
           });

           if (defaultCase) {
             walk(defaultCase.body || defaultCase.Body);
           }

           for (let k = 0; k < caseCount; k++) {
             forth += "THEN \n";
           }
           forth += "DROP \n"; 
        }
        break;
      case 'for':
        if (node.headers && node.headers[0]) walk(node.headers[0]);
        forth += `BEGIN \n`;
        if (node.headers && node.headers[1] && node.headers[1].body && node.headers[1].body.length > 0) {
          walk(node.headers[1]);
        } else {
          forth += `1 `;
        }
        forth += `WHILE \n`;
        walk(node.body);
        if (node.headers && node.headers[2]) walk(node.headers[2]);
        forth += `REPEAT \n`;
        break;
      case 'typedef':
        declaredStructs.add(node.name);
        let offset = 0;
        node.fields.forEach(field => {
          forth += `${offset} CONSTANT ${node.name}.${field.name} \n`;
          offset += 4;
        });
        forth += `${offset} CONSTANT ${node.name}.size \n`;
        break;
      case 'ident':
        const varName = symbolTable.lookup(node.value);
        const varType = symbolTable.lookupType(node.value);
        if (varName) {
           forth += `${varName} `;
           if (!isLValue && !declaredStructs.has(varType)) forth += `@ `;
        } else forth += `${node.value} `;
        break;
      case 'number':
        forth += `${node.value} `;
        break;
      case 'exec': walk(node.expr); break;
      case 'expr': 
        if (node.body.length === 2 && node.body[0].tag === 'ident' && (node.body[1].value === '++' || node.body[1].value === '--')) {
           const varName = symbolTable.lookup(node.body[0].value) || node.body[0].value;
           const op = node.body[1].value === '++' ? '1 +' : '1 -';
           forth += `${varName} @ ${op} ${varName} ! \n`;
        } else {
           handleExpression(node.body, isLValue);
        }
        break;
      case 'call':
        let funcName = "";
        if (node.func.tag === 'access') funcName = `${node.func.struct.value}.${node.func.member}`;
        else if (node.func.tag === 'ident') funcName = node.func.value;
        if (funcName) {
          if (node.args) walk(node.args);
          forth += `S" ${funcName}" SCALL \n`;
        }
        break;
      case 'access':
        const structType = symbolTable.lookupType(node.struct.value);
        walk(node.struct, isLValue);
        if (structType && structType !== 'auto') {
           forth += `${structType}.${node.member} + `;
        } else {
           forth += `${node.member} + `;
        }
        if (!isLValue) forth += `@ `;
        break;
      case 'string':
        forth += `S" ${node.value.slice(1, -1)}" `;
        break;
      case 'op':
        if (node.value === '++') forth += `1 + `;
        else if (node.value === '--') forth += `1 - `;
        else forth += `${opMap[node.value] || node.value} `;
        break;
      default:
        console.warn('Unhandled node tag:', node.tag);
    }
  }

  walk(ast);
  return forth;
}

const ast = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const forth = emit(ast);
fs.writeFileSync(process.argv[3], forth);
console.log("Forth code generated in", process.argv[3]);
