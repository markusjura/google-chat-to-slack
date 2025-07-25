import type { chat_v1 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import { transformMessage } from '../../services/google-chat';

describe('transformMessage', () => {
  it('should handle messages without formattedText', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      text: 'Simple text message',
    };

    const result = transformMessage(message);

    expect(result.text).toBe('Simple text message');
    expect(result.formattedText).toBeUndefined();
  });

  it('Fix 1: should move asterisk from between newlines to beginning of bold text', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '\n*\nbold text*',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe('\n\n*bold text*');
  });

  it('Fix 1: should move underscore from between newlines to beginning of italic text', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '\n_\nitalic text_',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe('\n\n_italic text_');
  });

  it('Fix 2: should remove orphaned leading asterisks', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '*orphaned text without closing asterisk',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe('orphaned text without closing asterisk');
  });

  it('Fix 2: should remove orphaned leading underscores', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '_orphaned text without closing underscore',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe(
      'orphaned text without closing underscore'
    );
  });

  it('Fix 3: should remove standalone asterisks between newlines', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: 'line 1\n*\nline 2',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe('line 1\n\nline 2');
  });

  it('Fix 3: should remove standalone underscores between newlines', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: 'line 1\n_\nline 2',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe('line 1\n\nline 2');
  });

  it('Fix 4: should add newline after closing code block when followed by text', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '\n```code\n```new text',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe('\n```code\n```\nnew text');
  });

  it('Fix 4: should handle the specific case from import.json', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: 'Separate code block:\n```code\n```new text',
    };

    const result = transformMessage(message);

    expect(result.formattedText).toBe(
      'Separate code block:\n```code\n```\nnew text'
    );
  });

  it('Fix 4: should not modify properly formatted code blocks', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText:
        'Some `inline` code\n\nSeparate code block:\n```\ncode here\n```\n\nMore text after',
    };

    const result = transformMessage(message);

    // Should remain unchanged since it's already properly formatted
    expect(result.formattedText).toBe(
      'Some `inline` code\n\nSeparate code block:\n```\ncode here\n```\n\nMore text after'
    );
  });

  it('should handle the underscore case: \\n_\\n_*Code Blocks*', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '\n_\n_*Code Blocks*',
    };

    const result = transformMessage(message);

    // Let's debug what we actually get
    console.log('Input:', JSON.stringify(message.formattedText));
    console.log('Output:', JSON.stringify(result.formattedText));

    expect(result.formattedText).toBe('\n\n*Code Blocks*');
  });

  it('Debug: should remove leading underscore from line starting with _*', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: '_*Code Blocks*',
    };

    const result = transformMessage(message);

    console.log('Simple Input:', JSON.stringify(message.formattedText));
    console.log('Simple Output:', JSON.stringify(result.formattedText));

    expect(result.formattedText).toBe('*Code Blocks*');
  });

  it('should handle mixed asterisk and underscore formatting', () => {
    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText:
        '\n*\nbold text* and \n_\nitalic text_ with *orphaned asterisk and _orphaned underscore',
    };

    const result = transformMessage(message);

    // Fix 1 moves format chars from between newlines to beginning of text
    // Fix 2 only removes orphaned format chars at the beginning of lines (not in middle of text)
    // Fix 3 removes standalone format chars between newlines
    expect(result.formattedText).toBe(
      '\n\n*bold text* and \n\n_italic text_ with *orphaned asterisk and _orphaned underscore'
    );
  });

  it('should handle all fixes in combination with real import.json data', () => {
    // This is the corrected formattedText from import.json after all fixes are applied
    const inputFormattedText = `*Bullet Points*
* bullet 1
* bullet 2
* *bold bullet 3*

non-bold text with prior bold new line

- dashed bullet 1
- dashed bullet 2
- dashed bullet3

1. asd
2. asd
3. asd

*New headline with bold line*

* bullet with bold: we continue bold*
* *bullet with heading: *this is some text
* bullet without heading: *bold text*
* bullet without heading

*Links*
* Pure link: https://drive.google.com 
* Described <https://mail.google.com/chat/u/0/#chat/space/AAQA7_i-uP4|link>

*Formatting*
* *Bold* with _italic_ text
* ~superscript~
* underlined text`;

    const message: chat_v1.Schema$Message = {
      name: 'spaces/test/messages/123',
      formattedText: inputFormattedText,
    };

    const result = transformMessage(message);

    // This should match the expected output from import.json
    expect(result.formattedText).toContain('*Bullet Points*');
    expect(result.formattedText).toContain('* bullet 1');
    expect(result.formattedText).toContain('* *bold bullet 3*');
    expect(result.formattedText).toContain('*New headline with bold line*');
    expect(result.formattedText).toContain(
      '* bullet without heading: *bold text*'
    );
    expect(result.formattedText).toContain('*Links*');
    expect(result.formattedText).toContain('*Formatting*');
    expect(result.formattedText).toContain('* *Bold* with _italic_ text');

    // Ensure the result matches the expected corrected format
    expect(result.formattedText).toBe(inputFormattedText);
  });
});
