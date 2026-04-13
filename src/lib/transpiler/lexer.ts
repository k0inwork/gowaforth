export enum TokenType {
  ILLEGAL = 'ILLEGAL',
  EOF = 'EOF',

  // Identifiers + literals
  IDENT = 'IDENT',
  STRING = 'STRING',

  // Operators & Punctuation
  LPAREN = '(',
  RPAREN = ')',
  LBRACE = '{',
  RBRACE = '}',
  DOT = '.',

  // Keywords
  FUNC = 'FUNC',
}

export interface Token {
  type: TokenType;
  literal: string;
}

const keywords: Record<string, TokenType> = {
  func: TokenType.FUNC,
};

function lookupIdent(ident: string): TokenType {
  if (keywords[ident]) {
    return keywords[ident];
  }
  return TokenType.IDENT;
}

export class Lexer {
  private input: string;
  private position: number = 0; // current position in input (points to current char)
  private readPosition: number = 0; // current reading position in input (after current char)
  private ch: string = ''; // current char under examination

  constructor(input: string) {
    this.input = input;
    this.readChar();
  }

  private readChar() {
    if (this.readPosition >= this.input.length) {
      this.ch = '\0';
    } else {
      this.ch = this.input[this.readPosition];
    }
    this.position = this.readPosition;
    this.readPosition += 1;
  }

  private peekChar(): string {
    if (this.readPosition >= this.input.length) {
      return '\0';
    } else {
      return this.input[this.readPosition];
    }
  }

  public nextToken(): Token {
    let tok: Token;

    this.skipWhitespace();

    switch (this.ch) {
      case '(':
        tok = this.newToken(TokenType.LPAREN, this.ch);
        break;
      case ')':
        tok = this.newToken(TokenType.RPAREN, this.ch);
        break;
      case '{':
        tok = this.newToken(TokenType.LBRACE, this.ch);
        break;
      case '}':
        tok = this.newToken(TokenType.RBRACE, this.ch);
        break;
      case '.':
        tok = this.newToken(TokenType.DOT, this.ch);
        break;
      case '"':
        tok = this.newToken(TokenType.STRING, this.readString());
        break;
      case '\0':
        tok = this.newToken(TokenType.EOF, '');
        break;
      default:
        if (this.isLetter(this.ch)) {
          const literal = this.readIdentifier();
          const type = lookupIdent(literal);
          return this.newToken(type, literal);
        } else {
          tok = this.newToken(TokenType.ILLEGAL, this.ch);
        }
    }

    this.readChar();
    return tok;
  }

  private newToken(type: TokenType, literal: string): Token {
    return { type, literal };
  }

  private readIdentifier(): string {
    const position = this.position;
    while (this.isLetter(this.ch)) {
      this.readChar();
    }
    return this.input.substring(position, this.position);
  }

  private readString(): string {
    const position = this.position + 1;
    while (true) {
      this.readChar();
      if (this.ch === '"' || this.ch === '\0') {
        break;
      }
    }
    return this.input.substring(position, this.position);
  }

  private isLetter(ch: string): boolean {
    return (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_'
    );
  }

  private skipWhitespace() {
    while (
      this.ch === ' ' ||
      this.ch === '\t' ||
      this.ch === '\n' ||
      this.ch === '\r'
    ) {
      this.readChar();
    }
  }
}
